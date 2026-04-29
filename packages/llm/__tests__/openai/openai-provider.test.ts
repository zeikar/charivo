import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharivoProviderError } from "@charivo/core";

const openaiMocks = vi.hoisted(() => {
  const createCompletion = vi.fn(
    async (_payload: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      max_tokens?: number;
    }) => ({
      choices: [
        {
          message: { content: "Final answer" },
        },
      ],
    }),
  );

  class MockOpenAI {
    chat = {
      completions: {
        create: createCompletion,
      },
    };

    constructor(public config: unknown) {}
  }

  return { createCompletion, MockOpenAI };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { OpenAILLMProvider } from "../../src/openai/provider";

beforeEach(() => {
  openaiMocks.createCompletion.mockClear();
  openaiMocks.createCompletion.mockResolvedValue({
    choices: [
      {
        message: { content: "Final answer" },
      },
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAILLMProvider", () => {
  it("forwards configuration to the SDK", async () => {
    const provider = new OpenAILLMProvider({
      apiKey: "key",
      model: "custom",
      temperature: 0.5,
      maxTokens: 500,
    });

    await provider.generateResponse([{ role: "user", content: "hi" }]);

    expect(openaiMocks.createCompletion).toHaveBeenCalledWith({
      model: "custom",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.5,
      max_tokens: 500,
    });
  });

  it("wraps rate-limit errors as provider errors", async () => {
    const error = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    openaiMocks.createCompletion.mockRejectedValueOnce(error);
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
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
    openaiMocks.createCompletion.mockRejectedValueOnce(error);
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
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
    openaiMocks.createCompletion.mockRejectedValueOnce(error);
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "OpenAI server error",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("wraps network errors without status as provider errors", async () => {
    const error = new TypeError("fetch failed");
    openaiMocks.createCompletion.mockRejectedValueOnce(error);
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "fetch failed",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("propagates timeout errors without provider wrapping", async () => {
    vi.useFakeTimers();
    openaiMocks.createCompletion.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    const request = provider.generateResponse([
      { role: "user", content: "hi" },
    ]);
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "OpenAI LLM request timed out after 30000ms",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });
});
