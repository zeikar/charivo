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
  createOpenAISTTProvider: vi.fn(() => provider),
}));

vi.mock("../../src/media-recorder-helper", () => ({
  MediaRecorderHelper: vi.fn(() => recorder),
}));

vi.mock("../../src/openai/provider", () => ({
  createOpenAISTTProvider: providerMocks.createOpenAISTTProvider,
}));

import { createOpenAISTTTranscriber } from "@charivo/stt/openai";

beforeEach(() => {
  recorder.start.mockClear();
  recorder.stop.mockClear();
  recorder.isRecording.mockReset();
  recorder.isRecording.mockReturnValue(false);
  provider.transcribe.mockClear();
  provider.transcribe.mockResolvedValue("Hello");
  providerMocks.createOpenAISTTProvider.mockClear();
});

describe("OpenAISTTTranscriber", () => {
  it("creates the provider with browser mode enabled", () => {
    createOpenAISTTTranscriber({ apiKey: "key", defaultLanguage: "en" });

    expect(providerMocks.createOpenAISTTProvider).toHaveBeenCalledWith({
      apiKey: "key",
      defaultLanguage: "en",
      dangerouslyAllowBrowser: true,
    });
  });

  it("stores recording options and forwards them on stop", async () => {
    const transcriber = createOpenAISTTTranscriber({ apiKey: "key" });

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
    const transcriber = createOpenAISTTTranscriber({ apiKey: "key" });

    expect(transcriber.isRecording()).toBe(true);
  });

  it("surfaces recorder errors", async () => {
    recorder.start.mockRejectedValueOnce(new Error("mic denied"));
    const transcriber = createOpenAISTTTranscriber({ apiKey: "key" });

    await expect(transcriber.startRecording()).rejects.toThrow("mic denied");
  });

  it("surfaces provider errors", async () => {
    provider.transcribe.mockRejectedValueOnce(
      new Error("transcription failed"),
    );
    const transcriber = createOpenAISTTTranscriber({ apiKey: "key" });

    await transcriber.startRecording({ language: "en" });

    await expect(transcriber.stopRecording()).rejects.toThrow(
      "transcription failed",
    );
  });
});
