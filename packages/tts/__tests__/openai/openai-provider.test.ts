import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharivoProviderError } from "@charivo/core";

const openaiMocks = vi.hoisted(() => {
  const createSpeech = vi.fn(
    async (_payload: {
      model: string;
      voice: string;
      input: string;
      speed: number;
      format: string;
    }) => ({
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
    }),
  );

  class MockOpenAI {
    audio = {
      speech: {
        create: createSpeech,
      },
    };

    constructor(public config: unknown) {}
  }

  return { createSpeech, MockOpenAI };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { OpenAITTSProvider } from "../../src/openai/provider";

beforeEach(() => {
  openaiMocks.createSpeech.mockClear();
  openaiMocks.createSpeech.mockResolvedValue({
    arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAITTSProvider", () => {
  it("forwards configuration to the SDK", async () => {
    const provider = new OpenAITTSProvider({
      apiKey: "key",
      defaultModel: "tts-1-hd",
      defaultVoice: "alloy",
    });

    await provider.generateSpeech("hello", {
      voice: "nova",
      rate: 1.5,
    });

    expect(openaiMocks.createSpeech).toHaveBeenCalledWith({
      model: "tts-1-hd",
      voice: "nova",
      input: "hello",
      speed: 1.5,
      format: "wav",
    });
  });

  it("wraps rate-limit errors as provider errors", async () => {
    const error = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    openaiMocks.createSpeech.mockRejectedValueOnce(error);
    const provider = new OpenAITTSProvider({ apiKey: "key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
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
    openaiMocks.createSpeech.mockRejectedValueOnce(error);
    const provider = new OpenAITTSProvider({ apiKey: "key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
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
    openaiMocks.createSpeech.mockRejectedValueOnce(error);
    const provider = new OpenAITTSProvider({ apiKey: "key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "OpenAI server error",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("wraps network errors without status as provider errors", async () => {
    const error = new TypeError("fetch failed");
    openaiMocks.createSpeech.mockRejectedValueOnce(error);
    const provider = new OpenAITTSProvider({ apiKey: "key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "fetch failed",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("propagates timeout errors without provider wrapping", async () => {
    vi.useFakeTimers();
    openaiMocks.createSpeech.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const provider = new OpenAITTSProvider({ apiKey: "key" });

    const request = provider.generateSpeech("hello");
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "OpenAI TTS request timed out after 30000ms",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });
});
