import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealTimeLipSync, setupMouseTracking } from "../src";

class MockAnalyser {
  fftSize = 0;
  smoothingTimeConstant = 0;
  frequencyBinCount = 8;
  connect = vi.fn(() => undefined);
  disconnect = vi.fn(() => undefined);
  getByteFrequencyData = vi.fn((target: Uint8Array) => {
    target.fill(0);
    target[1] = 128;
    target[2] = 255;
    target[3] = 128;
  });
}

class MockMediaElementSource {
  connect = vi.fn(() => undefined);
  disconnect = vi.fn(() => undefined);
}

class MockAudioContext {
  static lastInstance: MockAudioContext | undefined;

  destination = {};
  state: AudioContextState = "running";
  analyser = new MockAnalyser();
  source = new MockMediaElementSource();
  createAnalyser = vi.fn(() => this.analyser as unknown as AnalyserNode);
  createMediaElementSource = vi.fn(
    (_audio: HTMLAudioElement) =>
      this.source as unknown as MediaElementAudioSourceNode,
  );
  resume = vi.fn(async () => undefined);

  constructor() {
    MockAudioContext.lastInstance = this;
  }
}

describe("RealTimeLipSync", () => {
  const originalAudioContext = window.AudioContext;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    MockAudioContext.lastInstance = undefined;
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
    const lipSync = new RealTimeLipSync();
    const onRmsUpdate = vi.fn();

    lipSync.connectToAudio(document.createElement("audio"), onRmsUpdate);
    lipSync.stop();

    expect(MockAudioContext.lastInstance?.createAnalyser).toHaveBeenCalled();
    expect(onRmsUpdate).toHaveBeenCalledWith(expect.any(Number));
    expect(onRmsUpdate).toHaveBeenLastCalledWith(0);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1);
  });

  it("disconnects analyser nodes during cleanup", () => {
    const lipSync = new RealTimeLipSync();

    lipSync.connectToAudio(document.createElement("audio"), vi.fn());
    lipSync.cleanup();

    expect(MockAudioContext.lastInstance?.source.disconnect).toHaveBeenCalled();
    expect(
      MockAudioContext.lastInstance?.analyser.disconnect,
    ).toHaveBeenCalled();
  });

  it("resumes a suspended audio context on play", () => {
    const lipSync = new RealTimeLipSync();
    const audio = document.createElement("audio");

    Object.defineProperty(window, "AudioContext", {
      value: class extends MockAudioContext {
        state: AudioContextState = "suspended";
      },
      configurable: true,
    });

    lipSync.connectToAudio(audio, vi.fn());
    audio.dispatchEvent(new Event("play"));

    expect(MockAudioContext.lastInstance?.resume).toHaveBeenCalledTimes(1);
  });
});

describe("setupMouseTracking", () => {
  it("tracks pointer movement and taps on the canvas", () => {
    const canvas = document.createElement("canvas");
    const target = {
      updateViewWithMouse: vi.fn(),
      handleMouseTap: vi.fn(),
    };

    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({
        left: 10,
        right: 110,
        top: 20,
        bottom: 120,
      }),
      configurable: true,
    });

    const cleanup = setupMouseTracking({ canvas, target });

    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 30, clientY: 40 }),
    );
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 30, clientY: 40 }),
    );
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 300, clientY: 400 }),
    );

    expect(target.updateViewWithMouse).toHaveBeenCalledWith({
      clientX: 30,
      clientY: 40,
    });
    expect(target.handleMouseTap).toHaveBeenCalledTimes(1);

    cleanup();
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 50, clientY: 60 }),
    );
    expect(target.updateViewWithMouse).toHaveBeenCalledTimes(1);
  });

  it("can bind pointer tracking to document mode", () => {
    const canvas = document.createElement("canvas");
    const target = {
      updateViewWithMouse: vi.fn(),
      handleMouseTap: vi.fn(),
    };

    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        right: 100,
        top: 0,
        bottom: 100,
      }),
      configurable: true,
    });

    const cleanup = setupMouseTracking({
      canvas,
      mode: "document",
      target,
    });

    document.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 12, clientY: 34 }),
    );
    document.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 12, clientY: 34 }),
    );

    expect(target.updateViewWithMouse).toHaveBeenCalledWith({
      clientX: 12,
      clientY: 34,
    });
    expect(target.handleMouseTap).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
