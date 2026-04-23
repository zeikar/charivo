import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaRecorderHelper } from "../src";

class MockTrack {
  stop = vi.fn(() => undefined);
}

class MockStream {
  constructor(private readonly tracks: MockTrack[]) {}

  getTracks = vi.fn(() => this.tracks);
}

class MockMediaRecorder {
  static lastInstance: MockMediaRecorder | undefined;
  static failOnStop = false;

  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  start = vi.fn(() => undefined);

  constructor(public readonly stream: MockStream) {
    MockMediaRecorder.lastInstance = this;
  }

  stop = vi.fn(() => {
    if (MockMediaRecorder.failOnStop) {
      this.onerror?.(new Error("recorder failed"));
      return;
    }

    this.onstop?.();
  });

  emitData(blob: Blob): void {
    this.ondataavailable?.({ data: blob });
  }
}

describe("MediaRecorderHelper", () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalMediaDevices = navigator.mediaDevices;

  beforeEach(() => {
    MockMediaRecorder.lastInstance = undefined;
    MockMediaRecorder.failOnStop = false;
    globalThis.MediaRecorder =
      MockMediaRecorder as unknown as typeof MediaRecorder;
  });

  afterEach(() => {
    globalThis.MediaRecorder = originalMediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("starts recording from the microphone and rejects duplicate starts", async () => {
    const tracks = [new MockTrack()];
    const stream = new MockStream(tracks);
    const getUserMedia = vi.fn(async () => stream);
    const helper = new MediaRecorderHelper();

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    await helper.start();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    expect(MockMediaRecorder.lastInstance?.start).toHaveBeenCalledTimes(1);
    expect(helper.isRecording()).toBe(true);

    await expect(helper.start()).rejects.toThrow("Already recording");
  });

  it("stops recording, returns a blob, and cleans up tracks", async () => {
    const tracks = [new MockTrack(), new MockTrack()];
    const stream = new MockStream(tracks);
    const getUserMedia = vi.fn(async () => stream);
    const helper = new MediaRecorderHelper();

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    await helper.start();
    MockMediaRecorder.lastInstance?.emitData(new Blob(["hello"]));

    const blob = await helper.stop();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(helper.isRecording()).toBe(false);
    tracks.forEach((track) => {
      expect(track.stop).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces microphone permission failures", async () => {
    const helper = new MediaRecorderHelper();
    const getUserMedia = vi.fn(async () => {
      throw new Error("permission denied");
    });

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    await expect(helper.start()).rejects.toThrow("permission denied");
    expect(helper.isRecording()).toBe(false);
  });

  it("rejects when the underlying recorder errors during stop", async () => {
    const stream = new MockStream([new MockTrack()]);
    const getUserMedia = vi.fn(async () => stream);
    const helper = new MediaRecorderHelper();

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    await helper.start();
    MockMediaRecorder.failOnStop = true;

    await expect(helper.stop()).rejects.toThrow("recorder failed");
    expect(helper.isRecording()).toBe(false);
  });

  it("aborts recording and stops all tracks without returning data", async () => {
    const tracks = [new MockTrack(), new MockTrack()];
    const stream = new MockStream(tracks);
    const getUserMedia = vi.fn(async () => stream);
    const helper = new MediaRecorderHelper();

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    await helper.start();
    helper.abort();

    expect(helper.isRecording()).toBe(false);
    tracks.forEach((track) => {
      expect(track.stop).toHaveBeenCalledTimes(1);
    });
    await expect(helper.stop()).rejects.toThrow("Not recording");
  });
});
