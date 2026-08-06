import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LLMMessage,
  LLMToolResponse,
  ToolDefinition,
} from "@charivo/core";

const providerMocks = vi.hoisted(() => {
  const generateResponse = vi.fn(
    async (_messages: Array<{ role: string; content: string }>) =>
      "openclaw message",
  );
  const generateResponseWithTools = vi.fn(
    async (
      _messages: unknown[],
      _tools: unknown[],
    ): Promise<{ content: string; toolCalls?: unknown[] }> => {
      throw new Error("generateResponseWithTools was not mocked for this test");
    },
  );
  const createOpenClawLLMProvider = vi.fn(() => ({
    generateResponse,
    generateResponseWithTools,
  }));
  return {
    generateResponse,
    generateResponseWithTools,
    createOpenClawLLMProvider,
  };
});

vi.mock("../../src/openclaw/provider", () => ({
  createOpenClawLLMProvider: providerMocks.createOpenClawLLMProvider,
}));

import {
  createOpenClawLLMClient,
  OpenClawLLMClientConfig,
} from "@charivo/llm/openclaw";

describe("OpenClawLLMClient", () => {
  beforeEach(() => {
    providerMocks.generateResponse.mockClear();
    providerMocks.generateResponse.mockResolvedValue("openclaw message");
    providerMocks.generateResponseWithTools.mockClear();
    providerMocks.createOpenClawLLMProvider.mockClear();
  });

  it("forces dangerouslyAllowBrowser true for browser usage", () => {
    createOpenClawLLMClient({
      token: "test-token",
      agentId: "main",
    });

    expect(providerMocks.createOpenClawLLMProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        agentId: "main",
        dangerouslyAllowBrowser: true,
      }),
    );
  });

  it("delegates call() to the provider's generateResponse", async () => {
    const client = createOpenClawLLMClient({ token: "token" });

    const messages = [{ role: "user" as const, content: "hello" }];
    const response = await client.call(messages);

    expect(response).toBe("openclaw message");
    expect(providerMocks.generateResponse).toHaveBeenCalledWith(messages);
  });

  it("delegates callWithTools() to the provider's generateResponseWithTools", async () => {
    const toolResponse: LLMToolResponse = {
      content: "",
      toolCalls: [{ id: "call_1", name: "set_expression", arguments: {} }],
    };
    providerMocks.generateResponseWithTools.mockResolvedValueOnce(toolResponse);
    const client = createOpenClawLLMClient({ token: "token" });

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

  it("never forwards sessionKey to the provider, even if a caller passes it", () => {
    // sessionKey isn't in OpenClawLLMClientConfig; widen the cast to prove an
    // untyped JS caller can't sneak it past the client either.
    createOpenClawLLMClient({
      token: "token",
      sessionKey: "conversation-abc",
    } as OpenClawLLMClientConfig & { sessionKey: string });

    const config = providerMocks.createOpenClawLLMProvider.mock.calls[0]![0];
    expect(config).not.toHaveProperty("sessionKey");
  });
});
