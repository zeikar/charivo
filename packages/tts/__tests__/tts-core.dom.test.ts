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

/**
 * Web-speech player whose speak() calls stay pending until settle() is
 * called explicitly, modeling a real SpeechSynthesisUtterance whose
 * onend/onerror (in WebTTSPlayer) fires asynchronously and independently of
 * when stop()/cancel() was issued -- including well after replacement
 * playback has already started.
 */
class ControllableWebPlayer {
  playbackMode = "web-speech" as const;
  private pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();

  speak = vi.fn((text: string, _options?: unknown) => {
    return new Promise<void>((resolve, reject) => {
      this.pending.set(text, { resolve, reject });
    });
  });

  // Mirrors WebTTSPlayer.stop(): issues the cancellation but does not itself
  // wait for (or guarantee) the utterance's own callback to fire.
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);

  /** Simulates the browser's onend callback finally arriving for `text`. */
  settle(text: string): void {
    this.pending.get(text)?.resolve();
    this.pending.delete(text);
  }
}

interface Gate<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** A promise the test settles by hand, to hold an operation pending. */
function createGate<T>(): Gate<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/**
 * Yields a full task turn (a setTimeout hop, not a microtask), so chained
 * microtasks AND already-queued timers settle before the assertion runs. Do
 * not simplify to `await Promise.resolve()`.
 */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Observes a promise's settlement without making the test wait for it, so
 * "resolves promptly" can be asserted instead of timing out.
 */
function trackSettlement(promise: Promise<unknown>): {
  state: "pending" | "resolved" | "rejected";
} {
  const tracked: { state: "pending" | "resolved" | "rejected" } = {
    state: "pending",
  };
  promise.then(
    () => {
      tracked.state = "resolved";
    },
    () => {
      tracked.state = "rejected";
    },
  );
  return tracked;
}

/** Collects unhandled rejections raised while `run` executes. */
async function captureUnhandledRejections(
  run: () => Promise<void>,
): Promise<unknown[]> {
  const captured: unknown[] = [];
  const capture = (reason: unknown): void => {
    captured.push(reason);
  };

  process.on("unhandledRejection", capture);
  try {
    await run();
    // Deliberate slack window: two task turns give Node room to report a
    // late unhandled rejection before we stop listening.
    await nextTask();
    await nextTask();
  } finally {
    process.off("unhandledRejection", capture);
  }

  return captured;
}

/**
 * Audio-mode player whose stop() and generateAudio() can be held pending, so
 * a test can land stop() inside one of speak()'s startup windows -- before
 * any playback exists for stop() to cancel.
 */
class ControllableAudioPlayer {
  playbackMode = "audio" as const;
  audioMimeType = "audio/wav";
  /** Synthesis gates by text; generateAudio() registers one per call. */
  readonly synthesis = new Map<string, Gate<ArrayBuffer>>();
  private stopGate: Gate<void> | null = null;
  private holdsStops = false;

  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);

  generateAudio = vi.fn((text: string, _options?: unknown) => {
    const gate = createGate<ArrayBuffer>();
    this.synthesis.set(text, gate);
    return gate.promise;
  });

  stop = vi.fn(() => {
    if (!this.holdsStops) {
      return Promise.resolve();
    }
    this.stopGate ??= createGate<void>();
    return this.stopGate.promise;
  });

  /** Every stop() from now on stays pending until releaseStop()/failStop(). */
  holdStops(): void {
    this.holdsStops = true;
  }

  releaseStop(): void {
    this.stopGate?.resolve();
  }

  failStop(error: Error): void {
    this.stopGate?.reject(error);
  }

  settleSynthesis(text: string): void {
    this.synthesis.get(text)?.resolve(new Uint8Array([1, 2, 3]).buffer);
  }

  failSynthesis(text: string, error: Error): void {
    this.synthesis.get(text)?.reject(error);
  }
}

/**
 * Web-speech player whose stop() completes asynchronously: the player-side
 * cancellation lands only when that stop settles, and it then cancels
 * whichever utterance is active at that moment. The TTSPlayer contract
 * permits this, so the manager must never dispatch new speech while a stop
 * it issued is still pending.
 */
class DelayedStopWebPlayer {
  playbackMode = "web-speech" as const;
  /** Texts the delayed player-side cancellation actually cancelled. */
  readonly cancelledTexts: string[] = [];
  private pending = new Map<string, () => void>();
  private activeText: string | null = null;
  private deferNext = false;
  private settleDeferredStop: (() => void) | null = null;

  speak = vi.fn((text: string, _options?: unknown) => {
    this.activeText = text;
    return new Promise<void>((resolve) => {
      this.pending.set(text, resolve);
    });
  });

  stop = vi.fn(() => {
    if (!this.deferNext) {
      this.cancelActive();
      return Promise.resolve();
    }

    this.deferNext = false;
    return new Promise<void>((resolve) => {
      this.settleDeferredStop = () => {
        this.cancelActive();
        resolve();
      };
    });
  });

  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);

  /** Holds the next stop() pending until settleStop(). */
  deferNextStop(): void {
    this.deferNext = true;
  }

  /** The delayed player-side cancellation finally lands. */
  settleStop(): void {
    const settle = this.settleDeferredStop;
    this.settleDeferredStop = null;
    settle?.();
  }

  /** Simulates the browser's onend callback arriving for `text`. */
  settle(text: string): void {
    this.pending.get(text)?.();
    this.pending.delete(text);
    if (this.activeText === text) {
      this.activeText = null;
    }
  }

  private cancelActive(): void {
    if (this.activeText === null) {
      return;
    }

    this.cancelledTexts.push(this.activeText);
    this.settle(this.activeText);
  }
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

    manager.setEventEmitter(emitter);

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

    manager.setEventEmitter(emitter);

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

    manager.setEventEmitter(emitter);

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

    manager.setEventEmitter(emitter);

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
    manager.setEventEmitter(emitter);

    // Spy on URL.revokeObjectURL before speak() creates the blob URL.
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");

    // Start speaking but do NOT await — onended never fires, session stays active.
    const speaking = manager.speak("hello", {});

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
    // (d) the interrupted speak() call settles on its own, even though
    // stop() itself rejected — its audio's onended/onerror can never fire
    // now, so cleanup's finally block must have resolved it deterministically.
    await expect(speaking).resolves.toBeUndefined();
  });
});

describe("TTSManagerImpl stop() settles interrupted playback", () => {
  beforeEach(installAudioMocks);
  afterEach(restoreAudioMocks);

  it("resolves an interrupted stateless-audio speak() call instead of leaving it pending forever", async () => {
    const player = new RemotePlayerWithAudio();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);
    manager.setEventEmitter(emitter);

    // NonFinalizingAudio's play() resolves without ever firing onended, so
    // without the fix this speak() call has no other way to settle.
    globalThis.Audio = NonFinalizingAudio as unknown as typeof Audio;

    const speaking = manager.speak("hello", {});

    await vi.waitFor(() =>
      expect(emitter.emit).toHaveBeenCalledWith(
        "tts:audio:start",
        expect.anything(),
      ),
    );

    await manager.stop();

    // No external trigger completes this on its own (onended/onerror are
    // unreachable once stop() clears them) -- stop() must settle it itself.
    await expect(speaking).resolves.toBeUndefined();
  });

  it("resolves an interrupted web-speech speak() call instead of leaving it pending on the player's own cancellation", async () => {
    const player = new ControllableWebPlayer();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);
    manager.setEventEmitter(emitter);

    // The underlying player promise for "hello" never settles on its own in
    // this test -- only stop() can unblock it.
    const speaking = manager.speak("hello", {});

    await vi.waitFor(() =>
      expect(emitter.emit).toHaveBeenCalledWith(
        "tts:audio:start",
        expect.anything(),
      ),
    );

    await manager.stop();

    await expect(speaking).resolves.toBeUndefined();
  });
});

describe("TTSManagerImpl stop() cancels a speak() still starting up", () => {
  beforeEach(installAudioMocks);
  afterEach(restoreAudioMocks);

  it("resolves a speak() whose synthesis is still pending when stop() lands", async () => {
    const player = new ControllableAudioPlayer();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);
    manager.setEventEmitter(emitter);

    const speaking = manager.speak("hello");
    const speakingState = trackSettlement(speaking);
    await vi.waitFor(() => expect(player.synthesis.has("hello")).toBe(true));

    await manager.stop();
    await nextTask();

    // The synthesis gate is deliberately still pending: the cancelled speak()
    // must settle on the stop, not on the provider's own timing.
    expect(speakingState.state).toBe("resolved");
    await expect(speaking).resolves.toBeUndefined();
    expect(MockAudio.instances).toHaveLength(0);
    expect(emitter.emit).not.toHaveBeenCalledWith("tts:audio:start", {});
  });

  it("resolves a speak() still awaiting its own pre-speech stop", async () => {
    const player = new ControllableAudioPlayer();
    player.holdStops();
    const manager = createTTSManager(player);

    const speaking = manager.speak("hello");
    const speakingState = trackSettlement(speaking);

    const stopping = manager.stop();
    await nextTask();

    expect(speakingState.state).toBe("resolved");
    await expect(speaking).resolves.toBeUndefined();
    expect(player.generateAudio).not.toHaveBeenCalled();

    player.releaseStop();
    await stopping;
  });

  it("consumes a pre-speech stop that rejects after the speak() was cancelled", async () => {
    const player = new ControllableAudioPlayer();
    player.holdStops();
    const manager = createTTSManager(player);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const speaking = manager.speak("hello");
    const speakingState = trackSettlement(speaking);

    const unhandled = await captureUnhandledRejections(async () => {
      const stopping = manager.stop();
      await nextTask();

      expect(speakingState.state).toBe("resolved");
      await expect(speaking).resolves.toBeUndefined();

      player.failStop(new Error("late stop failure"));
      await expect(stopping).rejects.toMatchObject({
        code: "CHARIVO_PROVIDER_ERROR",
      });
    });

    expect(unhandled).toEqual([]);
  });

  it("consumes a synthesis that rejects after the speak() was cancelled", async () => {
    const player = new ControllableAudioPlayer();
    const manager = createTTSManager(player);

    const speaking = manager.speak("hello");
    const speakingState = trackSettlement(speaking);
    await vi.waitFor(() => expect(player.synthesis.has("hello")).toBe(true));

    const unhandled = await captureUnhandledRejections(async () => {
      await manager.stop();
      await nextTask();

      expect(speakingState.state).toBe("resolved");
      await expect(speaking).resolves.toBeUndefined();

      player.failSynthesis("hello", new Error("late synthesis failure"));
    });

    expect(unhandled).toEqual([]);
    expect(MockAudio.instances).toHaveLength(0);
  });

  it("never starts playback when a cancelled synthesis resolves late", async () => {
    const player = new ControllableAudioPlayer();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);
    manager.setEventEmitter(emitter);

    const speaking = manager.speak("hello");
    await vi.waitFor(() => expect(player.synthesis.has("hello")).toBe(true));

    await manager.stop();
    await expect(speaking).resolves.toBeUndefined();

    player.settleSynthesis("hello");
    await nextTask();

    expect(MockAudio.instances).toHaveLength(0);
    expect(emitter.emit).not.toHaveBeenCalledWith("tts:audio:start", {});
  });

  it("does not dispatch web speech when stop() lands during the pre-speech stop", async () => {
    const player = new ControllableWebPlayer();
    const stopGate = createGate<void>();
    player.stop = vi.fn(() => stopGate.promise);
    const startSimulation = vi
      .spyOn(WebSpeechLipSyncSimulator.prototype, "startSimulation")
      .mockImplementation(() => undefined);
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);
    manager.setEventEmitter(emitter);

    const speaking = manager.speak("hello");
    const speakingState = trackSettlement(speaking);

    const stopping = manager.stop();
    await nextTask();

    expect(speakingState.state).toBe("resolved");
    await expect(speaking).resolves.toBeUndefined();

    // Release the player stop: the cancelled utterance must stay cancelled.
    stopGate.resolve();
    await stopping;
    await nextTask();

    expect(player.speak).not.toHaveBeenCalled();
    expect(startSimulation).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalledWith("tts:audio:start", {});
  });

  it("plays a speak() issued after stop() completed", async () => {
    const player = new RemotePlayerWithAudio();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);
    manager.setEventEmitter(emitter);

    await manager.stop();
    await manager.speak("hello");

    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0]!.play).toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:start", {});
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
  });

  it("never lets an older speak() start playback over a newer one", async () => {
    const player = new ControllableAudioPlayer();
    const manager = createTTSManager(player);

    const speakingA = manager.speak("A");
    await vi.waitFor(() => expect(player.synthesis.has("A")).toBe(true));

    const speakingB = manager.speak("B");
    await vi.waitFor(() => expect(player.synthesis.has("B")).toBe(true));

    // A's synthesis lands after B took over.
    player.settleSynthesis("A");
    await expect(speakingA).resolves.toBeUndefined();
    expect(MockAudio.instances).toHaveLength(0);

    player.settleSynthesis("B");
    await expect(speakingB).resolves.toBeUndefined();
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0]!.play).toHaveBeenCalled();
  });

  it("still rejects speak() when an uncancelled synthesis fails", async () => {
    const player = new ControllableAudioPlayer();
    const manager = createTTSManager(player);

    const speaking = manager.speak("hello");
    await vi.waitFor(() => expect(player.synthesis.has("hello")).toBe(true));

    player.failSynthesis("hello", new Error("synthesis exploded"));

    await expect(speaking).rejects.toMatchObject({
      code: "CHARIVO_PROVIDER_ERROR",
      message: "synthesis exploded",
    });
  });
});

describe("TTSManagerImpl serializes stops against new utterances", () => {
  beforeEach(installAudioMocks);
  afterEach(restoreAudioMocks);

  it("does not let a delayed player stop cancel a newer utterance", async () => {
    const player = new DelayedStopWebPlayer();
    const emitter = { emit: vi.fn() };
    const events: string[] = [];
    emitter.emit.mockImplementation((eventName: string) => {
      if (eventName === "tts:audio:start" || eventName === "tts:audio:end") {
        events.push(eventName);
      }
    });
    const manager = createTTSManager(player);
    manager.setEventEmitter(emitter);

    const speakingA = manager.speak("A");
    await vi.waitFor(() => expect(events).toEqual(["tts:audio:start"]));
    expect(player.speak).toHaveBeenCalledTimes(1);

    // This stop's player-side cancellation lands only when settleStop() runs.
    player.deferNextStop();
    const stopping = manager.stop();

    const speakingB = manager.speak("B");
    await nextTask();

    // B must not dispatch while the stop it would race is still pending.
    expect(player.speak).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["tts:audio:start"]);

    player.settleStop();
    await stopping;
    await expect(speakingA).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(player.speak).toHaveBeenCalledWith("B", undefined),
    );

    // The delayed cancellation could only reach pre-stop state.
    expect(player.cancelledTexts).toEqual(["A"]);
    expect(events).toEqual([
      "tts:audio:start", // A
      "tts:audio:end", // A, by the delayed stop's cleanup
      "tts:audio:start", // B
    ]);

    player.settle("B");
    await expect(speakingB).resolves.toBeUndefined();
    expect(events).toEqual([
      "tts:audio:start",
      "tts:audio:end",
      "tts:audio:start",
      "tts:audio:end", // B's own natural end
    ]);
  });

  it("resolves silently when a tts:audio:start listener stops re-entrantly (web speech)", async () => {
    const player = new ControllableWebPlayer();
    const manager = createTTSManager(player);
    const events: string[] = [];
    let stopping: Promise<void> | undefined;
    const emitter = {
      emit: vi.fn((eventName: string) => {
        if (eventName !== "tts:audio:start" && eventName !== "tts:audio:end") {
          return;
        }
        events.push(eventName);
        if (eventName === "tts:audio:start") {
          stopping = manager.stop();
        }
      }),
    };
    manager.setEventEmitter(emitter);

    await expect(manager.speak("hello")).resolves.toBeUndefined();
    await stopping;

    expect(player.speak).not.toHaveBeenCalled();
    expect(events).toEqual(["tts:audio:start", "tts:audio:end"]);
  });

  it("resolves silently when a tts:audio:start listener stops re-entrantly (stateless audio)", async () => {
    globalThis.Audio = NonFinalizingAudio as unknown as typeof Audio;

    const player = new RemotePlayerWithAudio();
    const manager = createTTSManager(player);
    const events: string[] = [];
    let stopping: Promise<void> | undefined;
    const emitter = {
      emit: vi.fn((eventName: string) => {
        if (eventName !== "tts:audio:start" && eventName !== "tts:audio:end") {
          return;
        }
        events.push(eventName);
        if (eventName === "tts:audio:start") {
          stopping = manager.stop();
        }
      }),
    };
    manager.setEventEmitter(emitter);

    await expect(manager.speak("hello")).resolves.toBeUndefined();
    await stopping;

    expect(MockAudio.instances[0]?.play).not.toHaveBeenCalled();
    expect(events).toEqual(["tts:audio:start", "tts:audio:end"]);
  });
});

describe("TTSManagerImpl web-speech session scoping", () => {
  it("does not let a late-arriving cancellation callback end a newer session, after the replacement utterance has already started", async () => {
    const player = new ControllableWebPlayer();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);
    manager.setEventEmitter(emitter);

    const events: string[] = [];
    emitter.emit.mockImplementation((eventName: string) => {
      if (eventName === "tts:audio:start" || eventName === "tts:audio:end") {
        events.push(eventName);
      }
    });

    // Turn A: fire-and-forget. The underlying player promise for "A" stays
    // pending until settle("A") simulates the browser's real cancellation
    // callback finally arriving -- independent of speak()/stop() timing.
    const speakingA = manager.speak("A");
    await vi.waitFor(() => expect(events).toEqual(["tts:audio:start"]));

    // Turn B starts while A's browser-side cancellation hasn't landed yet.
    // speak()'s own pre-play stop() must settle A's call itself.
    const speakingB = manager.speak("B");
    await expect(speakingA).resolves.toBeUndefined();

    await vi.waitFor(() =>
      expect(events).toEqual([
        "tts:audio:start", // A
        "tts:audio:end", // A, ended by B's pre-play stop()
        "tts:audio:start", // B
      ]),
    );

    // A's real cancellation callback finally arrives now, well after B's
    // utterance became the active session.
    player.settle("A");
    await Promise.resolve();
    await Promise.resolve();

    // A's stale completion must not end B's still-active session.
    expect(events).toEqual([
      "tts:audio:start",
      "tts:audio:end",
      "tts:audio:start",
    ]);

    player.settle("B");
    await expect(speakingB).resolves.toBeUndefined();

    expect(events).toEqual([
      "tts:audio:start", // A
      "tts:audio:end", // A
      "tts:audio:start", // B
      "tts:audio:end", // B's own natural end
    ]);
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

    manager.setEventEmitter(emitter);

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
    manager.setEventEmitter(emitter);

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
    manager.setEventEmitter(emitter);

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
