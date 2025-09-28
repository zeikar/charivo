import { beforeEach, describe, expect, it, vi } from "vitest";

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

    audio = {
      speech: {
        create: vi.fn(),
      },
    };

    constructor(public config: unknown) {}
  }

  return { createCompletion, MockOpenAI };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { OpenAILLMProvider } from "@charivo/llm-provider-openai";

beforeEach(() => {
  openaiMocks.createCompletion.mockClear();
});

describe("OpenAILLMProvider", () => {
  it("builds OpenAI requests with system prompt", async () => {
    const provider = new OpenAILLMProvider({ apiKey: "key", model: "gpt-4o" });

    const result = await provider.generateResponse(
      [{ role: "user", content: "hello" }],
      { id: "char", name: "Hiyori" },
    );

    expect(result).toBe("Final answer");
    expect(openaiMocks.createCompletion).toHaveBeenCalledTimes(1);
    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.model).toBe("gpt-4o");
    expect(payload.messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining("You are Hiyori"),
    });
  });

  it("wraps OpenAI errors", async () => {
    openaiMocks.createCompletion.mockRejectedValueOnce(new Error("boom"));
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("OpenAI LLM Error: boom");
  });
});
