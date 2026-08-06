import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharivoProviderError, ToolDefinition } from "@charivo/core";

const openaiMocks = vi.hoisted(() => {
  type ChatPayload = {
    model: string;
    messages: Array<Record<string, unknown>>;
    temperature?: number;
    max_tokens?: number;
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

function respondWithToolCall(toolCall: Record<string, unknown>): void {
  openaiMocks.createCompletion.mockResolvedValueOnce({
    choices: [{ message: { content: null, tool_calls: [toolCall] } }],
  });
}

describe("OpenAILLMProvider.generateResponseWithTools", () => {
  it("maps tool turns and definitions onto the chat.completions payload", async () => {
    const provider = new OpenAILLMProvider({ apiKey: "key" });

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

  it("omits the tools param when the round offers no tools", async () => {
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    await provider.generateResponseWithTools(
      [{ role: "user", content: "wrap up" }],
      [],
    );

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("tools");
  });

  it("returns the tool calls requested by the model with decoded arguments", async () => {
    respondWithToolCall({
      id: "call_1",
      type: "function",
      function: {
        name: "get_weather",
        arguments: '{"city":"Seoul","days":2}',
      },
    });
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    const response = await provider.generateResponseWithTools(
      [{ role: "user", content: "weather?" }],
      [weatherTool],
    );

    expect(response).toEqual({
      content: "",
      toolCalls: [
        {
          id: "call_1",
          name: "get_weather",
          arguments: { city: "Seoul", days: 2 },
        },
      ],
    });
  });

  it("omits toolCalls when the model answers with text", async () => {
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    const response = await provider.generateResponseWithTools(
      [{ role: "user", content: "hi" }],
      [weatherTool],
    );

    expect(response.content).toBe("Final answer");
    expect(response).not.toHaveProperty("toolCalls");
  });

  it.each([
    [
      "an empty id",
      {
        id: "",
        type: "function",
        function: { name: "get_weather", arguments: "{}" },
      },
      '"id"',
    ],
    [
      "a missing function name",
      { id: "call_1", type: "function", function: { arguments: "{}" } },
      '"function.name"',
    ],
    [
      "null arguments",
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: "null" },
      },
      '"function.arguments"',
    ],
    [
      "array arguments",
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: "[1]" },
      },
      '"function.arguments"',
    ],
    [
      "unparsable arguments",
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: "{oops" },
      },
      '"function.arguments"',
    ],
  ])("rejects a tool call with %s", async (_label, toolCall, field) => {
    respondWithToolCall(toolCall);
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    await expect(
      provider.generateResponseWithTools(
        [{ role: "user", content: "weather?" }],
        [weatherTool],
      ),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: expect.stringContaining(field),
    });
  });

  it("wraps request failures as provider errors", async () => {
    const error = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    openaiMocks.createCompletion.mockRejectedValueOnce(error);
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    await expect(
      provider.generateResponseWithTools(
        [{ role: "user", content: "hi" }],
        [weatherTool],
      ),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Rate limit exceeded",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
  });

  it("propagates timeout errors without provider wrapping", async () => {
    vi.useFakeTimers();
    openaiMocks.createCompletion.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const provider = new OpenAILLMProvider({ apiKey: "key" });

    const request = provider.generateResponseWithTools(
      [{ role: "user", content: "hi" }],
      [weatherTool],
    );
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "OpenAI LLM request timed out after 30000ms",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });
});
