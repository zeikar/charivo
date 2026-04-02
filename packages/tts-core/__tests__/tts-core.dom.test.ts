import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTTSManager } from "../src";

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

class RemotePlayerWithAudio {
  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  generateAudio = vi.fn(async () => new Uint8Array([1, 2, 3]));
}

class RemotePlayerWithoutAudio {
  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
}

class WebPlayer {
  speak = vi.fn(async (_text: string, _options?: unknown) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
}

describe("TTSManagerImpl", () => {
  const OriginalAudio = globalThis.Audio;

  beforeEach(() => {
    MockAudio.instances = [];
    globalThis.Audio = MockAudio as unknown as typeof Audio;
  });

  afterEach(() => {
    globalThis.Audio = OriginalAudio;
    vi.restoreAllMocks();
  });

  it("rebinds the event emitter and uses generateAudio when available", async () => {
    const player = new RemotePlayerWithAudio();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);

    manager.setEventEmitter(emitter);

    await manager.speak("hello", { volume: 0.4 });

    expect(player.generateAudio).toHaveBeenCalledWith("hello", { volume: 0.4 });
    expect(player.speak).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:start", {
      audioElement: expect.any(MockAudio),
    });
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
    expect(MockAudio.instances[0]?.volume).toBe(0.4);
  });

  it("falls back to player.speak when generateAudio is unavailable", async () => {
    const player = new RemotePlayerWithoutAudio();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);

    manager.setEventEmitter(emitter);

    await manager.speak("fallback text", { rate: 1.1 });

    expect(player.speak).toHaveBeenCalledWith("fallback text", { rate: 1.1 });
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:start", {
      audioElement: undefined,
    });
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
  });

  it("uses the web speech path and still emits audio lifecycle events", async () => {
    const player = new WebPlayer();
    const emitter = { emit: vi.fn() };
    const manager = createTTSManager(player);

    manager.setEventEmitter(emitter);

    await manager.speak("browser speech", { rate: 1.25 });

    expect(player.speak).toHaveBeenCalledWith("browser speech", { rate: 1.25 });
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:start", {
      audioElement: expect.any(HTMLAudioElement),
    });
    expect(emitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
  });
});
