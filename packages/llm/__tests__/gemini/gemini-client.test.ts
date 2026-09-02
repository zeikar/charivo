import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LLMMessage,
  LLMToolResponse,
  ToolDefinition,
} from "@charivo/core";

const providerMocks = vi.hoisted(() => {
  const generateResponse = vi.fn(
    async (_messages: Array<{ role: string; content: string }>) =>
      "gemini message",
  );
  const generateResponseWithTools = vi.fn(
    async (
      _messages: unknown[],
      _tools: unknown[],
    ): Promise<{ content: string; toolCalls?: unknown[] }> => {
      throw new Error("generateResponseWithTools was not mocked for this test");
    },
  );
  const createGeminiLLMProvider = vi.fn((_config: unknown) => ({
    generateResponse,
    generateResponseWithTools,
  }));
  return {
    generateResponse,
    generateResponseWithTools,
    createGeminiLLMProvider,
  };
});

vi.mock("../../src/gemini/provider", () => ({
  createGeminiLLMProvider: providerMocks.createGeminiLLMProvider,
}));

import { createGeminiLLMClient } from "@charivo/llm/gemini";

describe("GeminiLLMClient", () => {
  beforeEach(() => {
    providerMocks.generateResponse.mockClear();
    providerMocks.generateResponse.mockResolvedValue("gemini message");
    providerMocks.generateResponseWithTools.mockClear();
    providerMocks.createGeminiLLMProvider.mockClear();
  });

  it("forces dangerouslyAllowBrowser true while forwarding apiKey and model", () => {
    createGeminiLLMClient({
      apiKey: "test-api-key",
      model: "gemini-3.5-flash-lite",
    });

    expect(providerMocks.createGeminiLLMProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        model: "gemini-3.5-flash-lite",
        dangerouslyAllowBrowser: true,
      }),
    );
  });

  it("delegates call() to the provider's generateResponse", async () => {
    const client = createGeminiLLMClient({ apiKey: "test-api-key" });

    const messages = [{ role: "user" as const, content: "hello" }];
    const response = await client.call(messages);

    expect(response).toBe("gemini message");
    expect(providerMocks.generateResponse).toHaveBeenCalledWith(messages);
  });

  it("delegates callWithTools() to the provider's generateResponseWithTools", async () => {
    const toolResponse: LLMToolResponse = {
      content: "",
      toolCalls: [{ id: "call_1", name: "set_expression", arguments: {} }],
    };
    providerMocks.generateResponseWithTools.mockResolvedValueOnce(toolResponse);
    const client = createGeminiLLMClient({ apiKey: "test-api-key" });

    const messages: LLMMessage[] = [{ role: "user", content: "hello" }];
    const tools: ToolDefinition[] = [
      {
        type: "function",
        name: "set_expression",
        description: "Change the avatar expression",
        parameters: { type: "object", properties: {} },
      },
    ];

    const response = await client.callWithTools!(messages, tools);

    expect(response).toEqual(toolResponse);
    expect(providerMocks.generateResponseWithTools).toHaveBeenCalledWith(
      messages,
      tools,
    );
  });
});
