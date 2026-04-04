import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAppWavFileHandler } from "../src/cubism/lappwavfilehandler";

const audioMocks = vi.hoisted(() => {
  class MockAudioBufferSourceNode {
    buffer: AudioBuffer | null = null;
    connect = vi.fn((_node: unknown) => undefined);
    disconnect = vi.fn(() => undefined);
    start = vi.fn((_when: number) => undefined);
    stop = vi.fn(() => undefined);
  }

  class MockGainNode {
    connect = vi.fn((_node: unknown) => undefined);
    disconnect = vi.fn(() => undefined);
  }

  const sourceNode = new MockAudioBufferSourceNode();
  const gainNode = new MockGainNode();
  const buffer = {
    sampleRate: 4,
    duration: 1,
    getChannelData: vi.fn(() => Float32Array.from([1, -1, 0, 0])),
  } as unknown as AudioBuffer;

  class MockAudioContext {
    static instances: MockAudioContext[] = [];

    currentTime = 0;
    destination = {};
    decodeAudioData = vi.fn(async (_data: ArrayBuffer) => buffer);
    createBufferSource = vi.fn(
      () => sourceNode as unknown as AudioBufferSourceNode,
    );
    createGain = vi.fn(() => gainNode as unknown as GainNode);

    constructor() {
      MockAudioContext.instances.push(this);
    }
  }

  return {
    MockAudioContext,
    buffer,
    gainNode,
    sourceNode,
  };
});

const originalFetch = globalThis.fetch;
const originalAudioContext = window.AudioContext;
const originalWebkitAudioContext = (
  window as Window & { webkitAudioContext?: typeof AudioContext }
).webkitAudioContext;

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  audioMocks.MockAudioContext.instances = [];
  audioMocks.sourceNode.buffer = null;
  audioMocks.sourceNode.connect.mockClear();
  audioMocks.sourceNode.disconnect.mockClear();
  audioMocks.sourceNode.start.mockClear();
  audioMocks.sourceNode.stop.mockClear();
  audioMocks.gainNode.connect.mockClear();
  audioMocks.gainNode.disconnect.mockClear();
  audioMocks.buffer.getChannelData = vi.fn(() =>
    Float32Array.from([1, -1, 0, 0]),
  );

  Object.defineProperty(window, "AudioContext", {
    value: audioMocks.MockAudioContext,
    configurable: true,
  });
  Object.defineProperty(window, "webkitAudioContext", {
    value: undefined,
    configurable: true,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(window, "AudioContext", {
    value: originalAudioContext,
    configurable: true,
  });
  Object.defineProperty(window, "webkitAudioContext", {
    value: originalWebkitAudioContext,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe("LAppWavFileHandler", () => {
  it("no-ops when no browser audio context is available", () => {
    Object.defineProperty(window, "AudioContext", {
      value: undefined,
      configurable: true,
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    const handler = new LAppWavFileHandler();
    handler.start("/voice.wav");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("starts playback by fetching, decoding, and wiring audio nodes", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          arrayBuffer: async () => new ArrayBuffer(8),
        }) as Response,
    ) as typeof fetch;

    const handler = new LAppWavFileHandler();
    const stopSpy = vi.spyOn(handler, "stop");

    handler.start("/voice.wav");
    await flushPromises();
    await vi.waitFor(() => {
      expect(audioMocks.sourceNode.start).toHaveBeenCalledWith(0);
    });

    const context = audioMocks.MockAudioContext.instances[0]!;

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith("/voice.wav");
    expect(context.decodeAudioData).toHaveBeenCalled();
    expect(context.createBufferSource).toHaveBeenCalled();
    expect(context.createGain).toHaveBeenCalled();
    expect(audioMocks.sourceNode.connect).toHaveBeenCalledWith(
      audioMocks.gainNode,
    );
    expect(audioMocks.gainNode.connect).toHaveBeenCalledWith(
      context.destination,
    );
    expect(audioMocks.sourceNode.start).toHaveBeenCalledWith(0);
  });

  it("warns and stays inactive when fetch or decode fails", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network failed");
    }) as typeof fetch;

    const handler = new LAppWavFileHandler();
    handler.start("/voice.wav");
    await flushPromises();
    handler.update(0.5);

    expect(warnSpy).toHaveBeenCalledWith(
      "Live2D: Failed to start wav playback",
      expect.any(Error),
    );
    expect(handler.getRms()).toBe(0);
  });

  it("computes RMS while active and stops when playback ends", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          arrayBuffer: async () => new ArrayBuffer(8),
        }) as Response,
    ) as typeof fetch;

    const handler = new LAppWavFileHandler();
    handler.start("/voice.wav");
    await flushPromises();
    await vi.waitFor(() => {
      expect(audioMocks.sourceNode.start).toHaveBeenCalledWith(0);
    });

    const context = audioMocks.MockAudioContext.instances[0]!;
    context.currentTime = 0;

    handler.update(0.5);
    expect(handler.getRms()).toBeCloseTo(1, 5);

    context.currentTime = 1;
    const stopSpy = vi.spyOn(handler, "stop");
    handler.update(0.5);
    expect(stopSpy).toHaveBeenCalled();
  });

  it("disconnects nodes and tolerates repeated stops", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          arrayBuffer: async () => new ArrayBuffer(8),
        }) as Response,
    ) as typeof fetch;

    const handler = new LAppWavFileHandler();
    handler.start("/voice.wav");
    await flushPromises();
    await vi.waitFor(() => {
      expect(audioMocks.sourceNode.start).toHaveBeenCalledWith(0);
    });

    handler.stop();
    handler.stop();

    expect(audioMocks.sourceNode.stop).toHaveBeenCalledTimes(1);
    expect(audioMocks.sourceNode.disconnect).toHaveBeenCalledTimes(1);
    expect(audioMocks.gainNode.disconnect).toHaveBeenCalledTimes(1);
  });
});
