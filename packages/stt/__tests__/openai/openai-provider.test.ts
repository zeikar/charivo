import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharivoProviderError } from "@charivo/core";

const openaiMocks = vi.hoisted(() => {
  const createTranscription = vi.fn(
    async (_payload: { file: File; model: string; language?: string }) => ({
      text: "transcript",
    }),
  );

  class MockOpenAI {
    audio = {
      transcriptions: {
        create: createTranscription,
      },
    };

    constructor(public config: unknown) {}
  }

  return { createTranscription, MockOpenAI };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { OpenAISTTProvider } from "../../src/openai/provider";

beforeEach(() => {
  openaiMocks.createTranscription.mockClear();
  openaiMocks.createTranscription.mockResolvedValue({ text: "transcript" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAISTTProvider", () => {
  it("forwards configuration to the SDK", async () => {
    const provider = new OpenAISTTProvider({
      apiKey: "key",
      defaultLanguage: "en",
    });

    await provider.transcribe(new Blob(["audio"]), { language: "en" });

    expect(openaiMocks.createTranscription).toHaveBeenCalledWith({
      file: expect.any(File),
      model: "whisper-1",
      language: "en",
    });
  });

  it("wraps rate-limit errors as provider errors", async () => {
    const error = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    openaiMocks.createTranscription.mockRejectedValueOnce(error);
    const provider = new OpenAISTTProvider({ apiKey: "key" });

    await expect(
      provider.transcribe(new Blob(["audio"])),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Rate limit exceeded",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("wraps invalid-key errors as provider errors", async () => {
    const error = Object.assign(new Error("Invalid API key"), {
      status: 401,
    });
    openaiMocks.createTranscription.mockRejectedValueOnce(error);
    const provider = new OpenAISTTProvider({ apiKey: "key" });

    await expect(
      provider.transcribe(new Blob(["audio"])),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Invalid API key",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("wraps server errors as provider errors", async () => {
    const error = Object.assign(new Error("OpenAI server error"), {
      status: 500,
    });
    openaiMocks.createTranscription.mockRejectedValueOnce(error);
    const provider = new OpenAISTTProvider({ apiKey: "key" });

    await expect(
      provider.transcribe(new Blob(["audio"])),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "OpenAI server error",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("wraps network errors without status as provider errors", async () => {
    const error = new TypeError("fetch failed");
    openaiMocks.createTranscription.mockRejectedValueOnce(error);
    const provider = new OpenAISTTProvider({ apiKey: "key" });

    await expect(
      provider.transcribe(new Blob(["audio"])),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "fetch failed",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("propagates timeout errors without provider wrapping", async () => {
    vi.useFakeTimers();
    openaiMocks.createTranscription.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const provider = new OpenAISTTProvider({ apiKey: "key" });

    const request = provider.transcribe(new Blob(["audio"]));
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "OpenAI STT request timed out after 30000ms",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });
});
