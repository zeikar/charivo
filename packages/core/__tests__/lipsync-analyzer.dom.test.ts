import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { createLipSyncAnalyzer } from "../src/lipsync-analyzer";

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

class MockSourceNode {
  connect = vi.fn(() => undefined);
  disconnect = vi.fn(() => undefined);
}

class MockAudioContext {
  static lastInstance: MockAudioContext | undefined;
  static instanceCount = 0;

  destination = {};
  state: AudioContextState = "running";
  analyser = new MockAnalyser();
  elementSource = new MockSourceNode();
  streamSource = new MockSourceNode();
  createAnalyser = vi.fn(() => this.analyser as unknown as AnalyserNode);
  createMediaElementSource = vi.fn(
    (_audio: HTMLAudioElement) =>
      this.elementSource as unknown as MediaElementAudioSourceNode,
  );
  createMediaStreamSource = vi.fn(
    (_stream: MediaStream) =>
      this.streamSource as unknown as MediaStreamAudioSourceNode,
  );
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);

  constructor() {
    MockAudioContext.lastInstance = this;
    MockAudioContext.instanceCount += 1;
  }
}

describe("createLipSyncAnalyzer", () => {
  const originalAudioContext = window.AudioContext;
  let requestAnimationFrameSpy: MockInstance<
    (callback: FrameRequestCallback) => number
  >;
  let cancelAnimationFrameSpy: MockInstance<(handle: number) => void>;

  beforeEach(() => {
    MockAudioContext.lastInstance = undefined;
    MockAudioContext.instanceCount = 0;
    Object.defineProperty(window, "AudioContext", {
      value: MockAudioContext,
      configurable: true,
    });
    requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.defineProperty(window, "AudioContext", {
      value: originalAudioContext,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("analyzes audio and resets RMS when stopped", () => {
    const onRms = vi.fn();
    const analyzer = createLipSyncAnalyzer({ onRms });

    analyzer.attachMediaElement(document.createElement("audio"));
    analyzer.stop();

    expect(MockAudioContext.lastInstance?.createAnalyser).toHaveBeenCalled();
    expect(MockAudioContext.lastInstance?.analyser.fftSize).toBe(256);
    expect(MockAudioContext.lastInstance?.analyser.smoothingTimeConstant).toBe(
      0.8,
    );
    expect(
      MockAudioContext.lastInstance?.analyser.connect,
    ).toHaveBeenCalledWith(MockAudioContext.lastInstance?.destination);
    expect(onRms).toHaveBeenCalledWith(0.2125);
    expect(onRms).toHaveBeenLastCalledWith(0);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1);
  });

  it("disconnects analyser nodes during cleanup", async () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });

    analyzer.attachMediaElement(document.createElement("audio"));
    const context = MockAudioContext.lastInstance;
    await analyzer.cleanup();

    expect(context?.elementSource.disconnect).toHaveBeenCalled();
    expect(context?.analyser.disconnect).toHaveBeenCalled();
    expect(context?.close).toHaveBeenCalledTimes(1);
  });

  it("prepares audio contexts idempotently before attaching", async () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });
    const audio = document.createElement("audio");

    await analyzer.prepare();
    const firstInstance = MockAudioContext.lastInstance;
    await analyzer.prepare();
    analyzer.attachMediaElement(audio);

    expect(MockAudioContext.lastInstance).toBe(firstInstance);
    expect(MockAudioContext.instanceCount).toBe(1);
    expect(firstInstance?.createMediaElementSource).toHaveBeenCalledWith(audio);
  });

  it("resumes a suspended audio context on play", () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });
    const audio = document.createElement("audio");

    Object.defineProperty(window, "AudioContext", {
      value: class extends MockAudioContext {
        state: AudioContextState = "suspended";
      },
      configurable: true,
    });

    analyzer.attachMediaElement(audio);
    audio.dispatchEvent(new Event("play"));

    expect(MockAudioContext.lastInstance?.resume).toHaveBeenCalledTimes(1);
  });

  it("reports element source failures through onError", () => {
    const sourceError = new Error("createMediaElementSource failed");
    Object.defineProperty(window, "AudioContext", {
      value: class extends MockAudioContext {
        createMediaElementSource = vi.fn(
          (_audio: HTMLAudioElement): MediaElementAudioSourceNode => {
            throw sourceError;
          },
        );
      },
      configurable: true,
    });

    const onError = vi.fn();
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn(), onError });

    expect(() =>
      analyzer.attachMediaElement(document.createElement("audio")),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith(sourceError);
  });

  it("keeps stream analysis off the destination", () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });
    const stream = {} as MediaStream;

    analyzer.attachMediaStream(stream);

    const context = MockAudioContext.lastInstance!;
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(context.streamSource.connect).toHaveBeenCalledWith(context.analyser);
    expect(context.analyser.connect).not.toHaveBeenCalled();
  });

  it("ignores re-attaching the same stream", () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });
    const stream = {} as MediaStream;

    analyzer.attachMediaStream(stream);
    analyzer.attachMediaStream(stream);

    expect(
      MockAudioContext.lastInstance?.createMediaStreamSource,
    ).toHaveBeenCalledTimes(1);
  });

  it("restarts the loop after pause and resume", () => {
    const onRms = vi.fn();
    const analyzer = createLipSyncAnalyzer({ onRms });

    analyzer.attachMediaStream({} as MediaStream);
    analyzer.pause();
    expect(onRms).toHaveBeenLastCalledWith(0);

    analyzer.resume();

    expect(onRms).toHaveBeenLastCalledWith(0.2125);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);
  });

  it("does not resume after stop until the next attach", () => {
    const onRms = vi.fn();
    const analyzer = createLipSyncAnalyzer({ onRms });

    analyzer.attachMediaStream({} as MediaStream);
    analyzer.stop();
    analyzer.resume();

    expect(onRms).toHaveBeenLastCalledWith(0);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
  });

  it("re-attaches the same stream after stop", () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });
    const stream = {} as MediaStream;

    analyzer.attachMediaStream(stream);
    analyzer.stop();
    analyzer.attachMediaStream(stream);

    expect(
      MockAudioContext.lastInstance?.createMediaStreamSource,
    ).toHaveBeenCalledTimes(2);
  });

  it("resolves cleanup only after the audio context is closed", async () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });
    await analyzer.prepare();

    const context = MockAudioContext.lastInstance!;
    let resolveClose: (() => void) | undefined;
    context.close.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveClose = () => resolve(undefined);
        }),
    );

    let settled = false;
    const cleanupPromise = analyzer.cleanup().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveClose?.();
    await cleanupPromise;

    expect(settled).toBe(true);
  });

  it("creates a fresh context when prepare races an in-flight cleanup", async () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });
    await analyzer.prepare();

    const context = MockAudioContext.lastInstance!;
    let resolveClose: (() => void) | undefined;
    context.close.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveClose = () => resolve(undefined);
        }),
    );

    const cleanupPromise = analyzer.cleanup();
    await analyzer.prepare();

    expect(MockAudioContext.instanceCount).toBe(2);
    expect(MockAudioContext.lastInstance).not.toBe(context);

    resolveClose?.();
    await cleanupPromise;
  });

  it("rejects cleanup when closing fails without poisoning the next session", async () => {
    const analyzer = createLipSyncAnalyzer({ onRms: vi.fn() });
    await analyzer.prepare();

    const context = MockAudioContext.lastInstance!;
    const closeError = new Error("close failed");
    context.close.mockImplementation(() => Promise.reject(closeError));

    await expect(analyzer.cleanup()).rejects.toBe(closeError);

    await analyzer.prepare();

    expect(MockAudioContext.instanceCount).toBe(2);
    expect(MockAudioContext.lastInstance).not.toBe(context);
  });
});
