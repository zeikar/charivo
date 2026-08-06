import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LLMMessage,
  LLMToolResponse,
  ToolDefinition,
} from "@charivo/core";

const providerMocks = vi.hoisted(() => {
  const generateResponse = vi.fn(
    async (_messages: Array<{ role: string; content: string }>) =>
      "assistant message",
  );
  const generateResponseWithTools = vi.fn(
    async (
      _messages: unknown[],
      _tools: unknown[],
    ): Promise<{ content: string; toolCalls?: unknown[] }> => {
      throw new Error("generateResponseWithTools was not mocked for this test");
    },
  );
  const createOpenAILLMProvider = vi.fn(() => ({
    generateResponse,
    generateResponseWithTools,
  }));
  return {
    generateResponse,
    generateResponseWithTools,
    createOpenAILLMProvider,
  };
});

vi.mock("../../src/openai/provider", () => ({
  createOpenAILLMProvider: providerMocks.createOpenAILLMProvider,
}));

import { createOpenAILLMClient } from "@charivo/llm/openai";

describe("OpenAILLMClient", () => {
  beforeEach(() => {
    providerMocks.generateResponse.mockClear();
    providerMocks.generateResponse.mockResolvedValue("assistant message");
    providerMocks.generateResponseWithTools.mockClear();
    providerMocks.createOpenAILLMProvider.mockClear();
  });

  it("enforces browser usage via configuration", () => {
    createOpenAILLMClient({ apiKey: "test", model: "gpt-4o" });

    expect(providerMocks.createOpenAILLMProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test",
        model: "gpt-4o",
        dangerouslyAllowBrowser: true,
      }),
    );
  });

  it("delegates calls to the provider", async () => {
    const client = createOpenAILLMClient({ apiKey: "key" });

    const messages = [{ role: "user" as const, content: "hello" }];
    const response = await client.call(messages);

    expect(response).toBe("assistant message");
    expect(providerMocks.generateResponse).toHaveBeenCalledWith(messages);
  });

  it("delegates tool calls to the provider", async () => {
    const toolResponse: LLMToolResponse = {
      content: "",
      toolCalls: [{ id: "call_1", name: "set_expression", arguments: {} }],
    };
    providerMocks.generateResponseWithTools.mockResolvedValueOnce(toolResponse);
    const client = createOpenAILLMClient({ apiKey: "key" });

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
