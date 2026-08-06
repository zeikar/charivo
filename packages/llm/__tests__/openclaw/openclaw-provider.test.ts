import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharivoProviderError, type ToolDefinition } from "@charivo/core";

const openaiMocks = vi.hoisted(() => {
  const instances: { config: unknown }[] = [];

  type ChatPayload = {
    model: string;
    messages: Array<Record<string, unknown>>;
    temperature?: number;
    max_tokens?: number;
    user?: string;
    tools?: Array<Record<string, unknown>>;
  };

  type ChatCompletionLike = {
    choices: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<Record<string, unknown>>;
      };
    }>;
  };

  const createCompletion = vi.fn(
    async (_payload: ChatPayload): Promise<ChatCompletionLike> => ({
      choices: [
        {
          message: { content: "openclaw response" },
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

    constructor(public config: unknown) {
      instances.push(this);
    }
  }

  return { createCompletion, MockOpenAI, instances };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { OpenClawLLMProvider } from "../../src/openclaw/provider";

beforeEach(() => {
  openaiMocks.createCompletion.mockClear();
  openaiMocks.instances.length = 0;
});

describe("OpenClawLLMProvider", () => {
  it("omits the agent header when no agentId is given", () => {
    new OpenClawLLMProvider({
      token: "test-token",
      dangerouslyAllowBrowser: true,
    });

    const config = openaiMocks.instances[0]!.config as {
      defaultHeaders?: Record<string, string>;
    };
    expect(config).toMatchObject({
      apiKey: "test-token",
      baseURL: "http://127.0.0.1:18789/v1",
    });
    // No agentId: let the gateway route to its configured default agent.
    // Forcing "main" here 400s on gateways without a "main" agent.
    expect(config.defaultHeaders).toBeUndefined();
  });

  it("sends the agent header when agentId is provided", () => {
    new OpenClawLLMProvider({
      token: "my-token",
      baseURL: "http://192.168.1.10:9000/v1",
      agentId: "assistant",
      dangerouslyAllowBrowser: true,
    });

    expect(openaiMocks.instances[0]!.config).toMatchObject({
      baseURL: "http://192.168.1.10:9000/v1",
      defaultHeaders: { "x-openclaw-agent-id": "assistant" },
    });
  });

  it("uses default model 'openclaw/default' when not specified", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    const result = await provider.generateResponse([
      { role: "user", content: "hi" },
    ]);

    expect(result).toBe("openclaw response");
    expect(openaiMocks.createCompletion.mock.calls[0]![0].model).toBe(
      "openclaw/default",
    );
  });

  it("sends the full history when no session is pinned", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    const history = [
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "latest question" },
    ];

    await provider.generateResponse(history);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.messages).toEqual(history);
    expect(payload.user).toBeUndefined();
  });

  it("sends sessionKey as the user field to pin the gateway session", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      sessionKey: "conversation-abc",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([{ role: "user", content: "hi" }]);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.user).toBe("conversation-abc");
  });

  it("sends only system prompts and the latest turn when a session is pinned", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      sessionKey: "conversation-abc",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "latest question" },
    ]);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    // The gateway already holds the past turns for this session; resending them
    // would inject a duplicate copy of the history on top of its own.
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "latest question" },
    ]);
  });

  it("sends only system prompts when the latest message is a system message", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      sessionKey: "conversation-abc",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "system", content: "Session reset notice" },
    ]);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "system", content: "Session reset notice" },
    ]);
  });

  it("wraps request failures as CharivoProviderError", async () => {
    openaiMocks.createCompletion.mockRejectedValueOnce(new Error("timeout"));

    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(CharivoProviderError);
  });
});

const weatherTool: ToolDefinition = {
  type: "function",
  name: "get_weather",
  description: "Look up the weather",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

describe("OpenClawLLMProvider.generateResponseWithTools", () => {
  it("sends the full history and the tool definitions when no session is pinned", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponseWithTools(
      [
        { role: "system", content: "You are Hiyori" },
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: "checking",
          toolCalls: [
            { id: "call_1", name: "get_weather", arguments: { city: "Seoul" } },
          ],
        },
        { role: "tool", content: '{"temp":21}', toolCallId: "call_1" },
      ],
      [weatherTool],
    );

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: "checking",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Seoul"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"temp":21}' },
    ]);
    expect(payload.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Look up the weather",
          parameters: weatherTool.parameters,
        },
      },
    ]);
  });

  it("sends only system prompts and the latest user turn on the first pinned call", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      sessionKey: "conversation-abc",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponseWithTools(
      [
        { role: "system", content: "You are Hiyori" },
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "weather?" },
      ],
      [weatherTool],
    );

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "weather?" },
    ]);
    expect(payload.user).toBe("conversation-abc");
  });

  it("sends only system prompts and the trailing tool results on a pinned continuation", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      sessionKey: "conversation-abc",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponseWithTools(
      [
        { role: "system", content: "You are Hiyori" },
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_0", name: "get_weather", arguments: { city: "Seoul" } },
          ],
        },
        { role: "tool", content: '{"temp":21}', toolCallId: "call_0" },
        { role: "user", content: "and tomorrow?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "get_weather",
              arguments: { city: "Seoul", day: "tomorrow" },
            },
          ],
        },
        { role: "tool", content: '{"temp":24}', toolCallId: "call_1" },
      ],
      [weatherTool],
    );

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    // The earlier round (call_0) is already acknowledged and resent turns; a
    // naive `messages.filter(role === "tool")` would still include its result.
    // Only the trailing unbroken run of tool messages belongs to this turn.
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "tool", tool_call_id: "call_1", content: '{"temp":24}' },
    ]);
  });

  it("omits the tools param when the round offers no tools", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponseWithTools(
      [{ role: "user", content: "wrap up" }],
      [],
    );

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("tools");
  });

  it("returns the tool calls requested by the gateway with decoded arguments", async () => {
    openaiMocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"city":"Seoul"}',
                },
              },
            ],
          },
        },
      ],
    });
    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    const response = await provider.generateResponseWithTools(
      [{ role: "user", content: "weather?" }],
      [weatherTool],
    );

    expect(response).toEqual({
      content: "",
      toolCalls: [
        { id: "call_1", name: "get_weather", arguments: { city: "Seoul" } },
      ],
    });
  });

  it("wraps request failures as CharivoProviderError", async () => {
    openaiMocks.createCompletion.mockRejectedValueOnce(new Error("timeout"));

    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    await expect(
      provider.generateResponseWithTools(
        [{ role: "user", content: "hi" }],
        [weatherTool],
      ),
    ).rejects.toThrow(CharivoProviderError);
  });
});
