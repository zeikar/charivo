import { describe, expect, it, vi } from "vitest";
import { createSTTManager } from "../src";

describe("STTManagerImpl", () => {
  it("starts recording and emits stt:start", async () => {
    const transcriber = {
      startRecording: vi.fn(async () => undefined),
      stopRecording: vi.fn(async () => "unused"),
      isRecording: vi.fn(() => false),
    };
    const emitter = { emit: vi.fn() };
    const manager = createSTTManager(transcriber);

    manager.setEventEmitter(emitter);

    await manager.start({ language: "en" });

    expect(transcriber.startRecording).toHaveBeenCalledWith({ language: "en" });
    expect(emitter.emit).toHaveBeenCalledWith("stt:start", {
      options: { language: "en" },
    });
  });

  it("stops recording, returns transcription, and emits stt:stop", async () => {
    const transcriber = {
      startRecording: vi.fn(async () => undefined),
      stopRecording: vi.fn(async () => "hello world"),
      isRecording: vi.fn(() => false),
    };
    const emitter = { emit: vi.fn() };
    const manager = createSTTManager(transcriber);

    manager.setEventEmitter(emitter);

    await manager.start();
    const transcription = await manager.stop();

    expect(transcription).toBe("hello world");
    expect(emitter.emit).toHaveBeenCalledWith("stt:stop", {
      transcription: "hello world",
    });
  });

  it("delegates isRecording to the transcriber", () => {
    const transcriber = {
      startRecording: vi.fn(async () => undefined),
      stopRecording: vi.fn(async () => ""),
      isRecording: vi.fn(() => true),
    };
    const manager = createSTTManager(transcriber);

    expect(manager.isRecording()).toBe(true);
    expect(transcriber.isRecording).toHaveBeenCalledTimes(1);
  });

  it("emits stt:error when start fails", async () => {
    const error = new Error("mic denied");
    const transcriber = {
      startRecording: vi.fn(async () => {
        throw error;
      }),
      stopRecording: vi.fn(async () => ""),
      isRecording: vi.fn(() => false),
    };
    const emitter = { emit: vi.fn() };
    const manager = createSTTManager(transcriber);

    manager.setEventEmitter(emitter);

    await expect(manager.start()).rejects.toThrow("mic denied");
    expect(emitter.emit).toHaveBeenCalledWith("stt:error", { error });
  });

  it("emits stt:error when stop fails", async () => {
    const error = new Error("transcription failed");
    const transcriber = {
      startRecording: vi.fn(async () => undefined),
      stopRecording: vi.fn(async () => {
        throw error;
      }),
      isRecording: vi.fn(() => true),
    };
    const emitter = { emit: vi.fn() };
    const manager = createSTTManager(transcriber);

    manager.setEventEmitter(emitter);

    await expect(manager.stop()).rejects.toThrow("transcription failed");
    expect(emitter.emit).toHaveBeenCalledWith("stt:error", { error });
  });
});
