import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTTSManager } from "../src";
import { WebSpeechLipSyncSimulator } from "../src/web-speech-lipsync-simulator";
import { getTTSAudioMimeType, getTTSPlaybackMode } from "../src/tts-utils";

class MockAudio {
  static instances: MockAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  preload = "";
  volume = 1;

  constructor(public readonly src: string) {
    MockAudio.instances.push(this);
  }

  play = vi.fn(async () => {
    queueMicrotask(() => {
      this.onended?.();
    });
  });

  pause = vi.fn(() => undefined);
}

// Play resolves without firing onended, so the session stays active.
class NonFinalizingAudio extends MockAudio {
  play = vi.fn(async () => undefined);
}

class MockAnalyser {
  fftSize = 0;
  smoothingTimeConstant = 0;
  frequencyBinCount = 128; // fftSize 256, as in production
  connect = vi.fn(() => undefined);
  disconnect = vi.fn(() => undefined);
  getByteFrequencyData = vi.fn((target: Uint8Array) => {
    // One saturated bin inside the [12, 76) speech band: sqrt(1 / 64) * 1.7 = 0.2125
    target.fill(0);
    target[40] = 255;
  });
}

class MockAudioContext {
  static lastInstance: MockAudioContext | undefined;
  static instanceCount = 0;

  destination = {};
  state: AudioContextState = "running";
  analyser = new MockAnalyser();
  elementSource = { connect: vi.fn(), disconnect: vi.fn() };
  createAnalyser = vi.fn(() => this.analyser as unknown as AnalyserNode);
  createMediaElementSource = vi.fn(
    (_audio: HTMLAudioElement) =>
      this.elementSource as unknown as MediaElementAudioSourceNode,
  );
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);

  constructor() {
    MockAudioContext.lastInstance = this;
    MockAudioContext.instanceCount += 1;
  }
}

class RemotePlayerWithAudio {
  playbackMode = "audio" as const;
  audioMimeType = "audio/wav";
  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  generateAudio = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
}

class RemotePlayerWithoutAudio {
  playbackMode = "audio" as const;
  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
}

class WebPlayer {
  playbackMode = "web-speech" as const;
  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
}

class ExplicitAudioPlayerWithWebName {
  playbackMode = "audio" as const;
  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  generateAudio = vi.fn(async () => new Uint8Array([4, 5, 6]).buffer);
}

class AudioPlayerWithCustomMime {
  playbackMode = "audio" as const;
  audioMimeType = "audio/mpeg";
  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
}

const OriginalAudio = globalThis.Audio;
const originalAudioContext = window.AudioContext;

/** jsdom ships no Web Audio API, so the manager needs a stand-in to analyze. */
function installAudioMocks(): void {
  MockAudio.instances = [];
  MockAudioContext.lastInstance = undefined;
  MockAudioContext.instanceCount = 0;
  globalThis.Audio = MockAudio as unknown as typeof Audio;
  Object.defineProperty(window, "AudioContext", {
    value: MockAudioContext,
    configurable: true,
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
}

function restoreAudioMocks(): void {
  globalThis.Audio = OriginalAudio;
  Object.defineProperty(window, "AudioContext", {
    value: originalAudioContext,
    configurable: true,
  });
  vi.restoreAllMocks();
}

describe("TTSManagerImpl", () => {
  beforeEach(installAudioMocks);
  afterEach(restoreAudioMocks);

  it("rebinds the event emitter and uses generateAudio when available", async () => {
    const player = new RemotePlayerWithAudio();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);

    manager.setEventEmitter!(emitter);

    await manager.speak("hello", { volume: 0.4 });

    expect(player.generateAudio).toHaveBeenCalledWith("hello", { volume: 0.4 });
    expect(player.speak).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:start", {});
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
    expect(MockAudio.instances[0]?.volume).toBe(0.4);
  });

  it("applies volume: 0 (mute) without silently ignoring it", async () => {
    const player = new RemotePlayerWithAudio();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);

    manager.setEventEmitter!(emitter);

    await manager.speak("mute", { volume: 0 });

    expect(MockAudio.instances[0]?.volume).toBe(0);
  });

  it("rejects audio-mode players that cannot generate audio", () => {
    expect(() => createTTSManager(new RemotePlayerWithoutAudio())).toThrow(
      /generateAudio/,
    );
  });

  it("uses the web speech path and still emits audio lifecycle events", async () => {
    const player = new WebPlayer();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);

    manager.setEventEmitter!(emitter);

    await manager.speak("browser speech", { rate: 1.25 });

    expect(player.speak).toHaveBeenCalledWith("browser speech", { rate: 1.25 });
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:start", {});
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
  });

  it("clamps rate: 0 to 0.1 for the web speech lip-sync simulation", async () => {
    const player = new WebPlayer();
    const manager = createTTSManager(player);
    const startSpy = vi
      .spyOn(WebSpeechLipSyncSimulator.prototype, "startSimulation")
      .mockImplementation(() => undefined);

    await manager.speak("hello", { rate: 0 });

    expect(startSpy).toHaveBeenCalledWith("hello", 0.1);
  });

  it("prefers explicit playback capabilities over constructor-name inference", async () => {
    const player = new ExplicitAudioPlayerWithWebName();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);

    manager.setEventEmitter!(emitter);

    await manager.speak("audio path");

    expect(player.generateAudio).toHaveBeenCalledWith("audio path", undefined);
    expect(player.speak).not.toHaveBeenCalled();
    expect(MockAudio.instances).toHaveLength(1);
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:start", {});
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
  });
});

describe("TTSManagerImpl stop() failure cleanup", () => {
  beforeEach(installAudioMocks);
  afterEach(restoreAudioMocks);

  it("runs cleanup and emits tts:audio:end even when ttsPlayer.stop() throws", async () => {
    // Player whose stop resolves once (absorbed by speak's internal stop call)
    // then rejects on the explicit manager.stop() under test.
    const player = new RemotePlayerWithAudio();
    player.stop = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("player stop failed"));

    // Replace generateAudio to return minimal data; audio is created via NonFinalizingAudio.
    player.generateAudio = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);

    // Install MockAudio variant whose play doesn't auto-finalize.
    globalThis.Audio = NonFinalizingAudio as unknown as typeof Audio;

    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);
    manager.setEventEmitter!(emitter);

    // Spy on URL.revokeObjectURL before speak() creates the blob URL.
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");

    // Start speaking but do NOT await — onended never fires, session stays active.
    // Attach the rejection handler immediately: stop() clears currentAudio and
    // orphans this promise, so suppress the unhandled rejection up front (airtight).
    const speaking = manager.speak("hello", {});
    speaking.catch(() => undefined);

    // Wait deterministically for the session to become active.
    await vi.waitFor(() =>
      expect(emitter.emit).toHaveBeenCalledWith(
        "tts:audio:start",
        expect.anything(),
      ),
    );

    // Capture the created audio instance.
    const audio = MockAudio.instances[0]! as NonFinalizingAudio;
    expect(audio).toBeDefined();

    // Act: stop() should reject with a CharivoProviderError.
    await expect(manager.stop()).rejects.toMatchObject({
      code: "CHARIVO_PROVIDER_ERROR",
      name: "CharivoProviderError",
    });

    // Assert cleanup ran despite the rejection:
    // (a) audio.pause was called
    expect(audio.pause).toHaveBeenCalled();
    // (b) blob URL was revoked
    expect(revokeSpy).toHaveBeenCalled();
    // (c) tts:audio:end was emitted
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
  });
});

describe("TTSManagerImpl lip-sync analysis", () => {
  const setVisibilityState = (state: DocumentVisibilityState): void => {
    Object.defineProperty(document, "visibilityState", {
      value: state,
      configurable: true,
    });
  };

  const lipSyncEmissions = (emitter: { emit: ReturnType<typeof vi.fn> }) =>
    emitter.emit.mock.calls
      .filter(([eventName]) => eventName === "tts:lipsync:update")
      .map(([, payload]) => payload as { rms: number });

  // Managers created below subscribe to browser lifecycle events
  // (ensureLifecycleBound()); track them so afterEach can dispose them and
  // release those subscriptions instead of letting them accumulate.
  let createdManagers: ReturnType<typeof createTTSManager>[] = [];
  const trackManager = (
    player: Parameters<typeof createTTSManager>[0],
  ): ReturnType<typeof createTTSManager> => {
    const manager = createTTSManager(player);
    createdManagers.push(manager);
    return manager;
  };

  beforeEach(() => {
    installAudioMocks();
    createdManagers = [];
  });

  afterEach(async () => {
    await Promise.all(createdManagers.map((manager) => manager.dispose?.()));
    setVisibilityState("visible");
    restoreAudioMocks();
  });

  it("analyzes the generated audio element and closes the mouth when it ends", async () => {
    const player = new RemotePlayerWithAudio();
    const emitter = { emit: vi.fn() };
    const manager = trackManager(player);

    manager.setEventEmitter!(emitter);

    await manager.speak("hello");

    const audio = MockAudio.instances[0]!;
    expect(
      MockAudioContext.lastInstance?.createMediaElementSource,
    ).toHaveBeenCalledWith(audio);

    const emissions = lipSyncEmissions(emitter);
    expect(emissions.some(({ rms }) => rms > 0)).toBe(true);
    expect(emissions.at(-1)).toEqual({ rms: 0 });
  });

  it("prepares the audio context once", async () => {
    const manager = trackManager(new RemotePlayerWithAudio());

    await manager.prepareAudio?.();
    await manager.prepareAudio?.();

    expect(MockAudioContext.instanceCount).toBe(1);
  });

  it("pauses analysis while the tab is hidden and resumes when visible", async () => {
    globalThis.Audio = NonFinalizingAudio as unknown as typeof Audio;

    const player = new RemotePlayerWithAudio();
    const emitter = { emit: vi.fn() };
    const manager = trackManager(player);
    manager.setEventEmitter!(emitter);

    const speaking = manager.speak("hello");
    speaking.catch(() => undefined);

    await vi.waitFor(() =>
      expect(emitter.emit).toHaveBeenCalledWith("tts:audio:start", {}),
    );

    emitter.emit.mockClear();
    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(lipSyncEmissions(emitter).at(-1)).toEqual({ rms: 0 });

    emitter.emit.mockClear();
    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(lipSyncEmissions(emitter).some(({ rms }) => rms > 0)).toBe(true);

    await manager.stop();
  });

  it("closes the audio context and unbinds lifecycle handlers on dispose", async () => {
    const player = new RemotePlayerWithAudio();
    const emitter = { emit: vi.fn() };
    const manager = trackManager(player);
    manager.setEventEmitter!(emitter);

    await manager.speak("hello");
    const context = MockAudioContext.lastInstance!;

    const disposal = manager.dispose?.();
    expect(context.close).toHaveBeenCalledTimes(1);
    await disposal;

    emitter.emit.mockClear();
    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe("tts capabilities", () => {
  it("resolves playback mode from explicit player capabilities", () => {
    expect(getTTSPlaybackMode(new WebPlayer())).toBe("web-speech");
    expect(getTTSPlaybackMode(new RemotePlayerWithoutAudio())).toBe("audio");
  });

  it("prefers an explicit audio mime type and falls back when missing", () => {
    expect(getTTSAudioMimeType(new AudioPlayerWithCustomMime())).toBe(
      "audio/mpeg",
    );
    expect(getTTSAudioMimeType(new RemotePlayerWithoutAudio())).toBe(
      "audio/wav",
    );
  });
});

describe("WebSpeechLipSyncSimulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits lip sync updates while simulating speech", () => {
    const emitter = { emit: vi.fn() };
    const simulator = new WebSpeechLipSyncSimulator(emitter);

    simulator.startSimulation("hello ai", 1);
    vi.runAllTimers();

    expect(emitter.emit).toHaveBeenCalled();
    expect(
      emitter.emit.mock.calls.some(
        ([eventName, payload]) =>
          eventName === "tts:lipsync:update" &&
          typeof payload.rms === "number" &&
          payload.rms > 0,
      ),
    ).toBe(true);
  });

  it("clears pending timers and closes the mouth on stop", () => {
    const emitter = { emit: vi.fn() };
    const simulator = new WebSpeechLipSyncSimulator(emitter);

    simulator.startSimulation("hello world", 1);
    simulator.stopSimulation();
    vi.runAllTimers();

    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith("tts:lipsync:update", { rms: 0 });
  });
});
