import { beforeEach, describe, expect, it, vi } from "vitest";

const recorder = {
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => new Blob(["audio"], { type: "audio/webm" })),
  isRecording: vi.fn(() => false),
};

const provider = {
  transcribe: vi.fn(async () => "Hello"),
};

const providerMocks = vi.hoisted(() => ({
  createGeminiSTTProvider: vi.fn(() => provider),
}));

vi.mock("../../src/media-recorder-helper", () => ({
  MediaRecorderHelper: vi.fn(() => recorder),
}));

vi.mock("../../src/gemini/provider", () => ({
  createGeminiSTTProvider: providerMocks.createGeminiSTTProvider,
}));

import { createGeminiSTTTranscriber } from "@charivo/stt/gemini";

beforeEach(() => {
  recorder.start.mockClear();
  recorder.stop.mockClear();
  recorder.isRecording.mockReset();
  recorder.isRecording.mockReturnValue(false);
  provider.transcribe.mockClear();
  provider.transcribe.mockResolvedValue("Hello");
  providerMocks.createGeminiSTTProvider.mockClear();
});

describe("GeminiSTTTranscriber", () => {
  it("creates the provider with browser mode enabled", () => {
    createGeminiSTTTranscriber({ apiKey: "key", defaultLanguage: "en" });

    expect(providerMocks.createGeminiSTTProvider).toHaveBeenCalledWith({
      apiKey: "key",
      defaultLanguage: "en",
      dangerouslyAllowBrowser: true,
    });
  });

  it("stores recording options and forwards them on stop", async () => {
    const transcriber = createGeminiSTTTranscriber({ apiKey: "key" });

    await transcriber.startRecording({ language: "en" });
    const result = await transcriber.stopRecording();

    expect(result).toBe("Hello");
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(provider.transcribe).toHaveBeenCalledWith(expect.any(Blob), {
      language: "en",
    });
  });

  it("delegates isRecording to the recorder helper", () => {
    recorder.isRecording.mockReturnValue(true);
    const transcriber = createGeminiSTTTranscriber({ apiKey: "key" });

    expect(transcriber.isRecording()).toBe(true);
  });

  it("surfaces recorder errors", async () => {
    recorder.start.mockRejectedValueOnce(new Error("mic denied"));
    const transcriber = createGeminiSTTTranscriber({ apiKey: "key" });

    await expect(transcriber.startRecording()).rejects.toThrow("mic denied");
  });

  it("surfaces provider errors", async () => {
    provider.transcribe.mockRejectedValueOnce(
      new Error("transcription failed"),
    );
    const transcriber = createGeminiSTTTranscriber({ apiKey: "key" });

    await transcriber.startRecording({ language: "en" });

    await expect(transcriber.stopRecording()).rejects.toThrow(
      "transcription failed",
    );
  });
});
