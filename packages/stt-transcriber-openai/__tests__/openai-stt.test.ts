import { beforeEach, describe, expect, it, vi } from "vitest";

const recorder = {
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => new Blob(["audio"], { type: "audio/webm" })),
  isRecording: vi.fn(() => false),
};

const provider = {
  transcribe: vi.fn(async () => "안녕하세요"),
};

const providerMocks = vi.hoisted(() => ({
  createOpenAISTTProvider: vi.fn(() => provider),
}));

vi.mock("@charivo/stt-core", () => ({
  MediaRecorderHelper: vi.fn(() => recorder),
}));

vi.mock("@charivo/stt-provider-openai", () => ({
  createOpenAISTTProvider: providerMocks.createOpenAISTTProvider,
}));

import { OpenAISTTTranscriber } from "@charivo/stt-transcriber-openai";

beforeEach(() => {
  recorder.start.mockClear();
  recorder.stop.mockClear();
  recorder.isRecording.mockReset();
  recorder.isRecording.mockReturnValue(false);
  provider.transcribe.mockClear();
  provider.transcribe.mockResolvedValue("안녕하세요");
  providerMocks.createOpenAISTTProvider.mockClear();
});

describe("OpenAISTTTranscriber", () => {
  it("creates the provider with browser mode enabled", () => {
    new OpenAISTTTranscriber({ apiKey: "key", defaultLanguage: "ko" });

    expect(providerMocks.createOpenAISTTProvider).toHaveBeenCalledWith({
      apiKey: "key",
      defaultLanguage: "ko",
      dangerouslyAllowBrowser: true,
    });
  });

  it("stores recording options and forwards them on stop", async () => {
    const transcriber = new OpenAISTTTranscriber({ apiKey: "key" });

    await transcriber.startRecording({ language: "ko" });
    const result = await transcriber.stopRecording();

    expect(result).toBe("안녕하세요");
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(provider.transcribe).toHaveBeenCalledWith(expect.any(Blob), {
      language: "ko",
    });
  });

  it("delegates isRecording to the recorder helper", () => {
    recorder.isRecording.mockReturnValue(true);
    const transcriber = new OpenAISTTTranscriber({ apiKey: "key" });

    expect(transcriber.isRecording()).toBe(true);
  });

  it("surfaces recorder errors", async () => {
    recorder.start.mockRejectedValueOnce(new Error("mic denied"));
    const transcriber = new OpenAISTTTranscriber({ apiKey: "key" });

    await expect(transcriber.startRecording()).rejects.toThrow("mic denied");
  });

  it("surfaces provider errors", async () => {
    provider.transcribe.mockRejectedValueOnce(
      new Error("transcription failed"),
    );
    const transcriber = new OpenAISTTTranscriber({ apiKey: "key" });

    await transcriber.startRecording({ language: "en" });

    await expect(transcriber.stopRecording()).rejects.toThrow(
      "transcription failed",
    );
  });
});
