import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharivoProviderError, ToolDefinition } from "@charivo/core";

const openaiMocks = vi.hoisted(() => {
  const instances: { config: unknown }[] = [];

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

    constructor(public config: unknown) {
      instances.push(this);
    }
  }

  return { createCompletion, MockOpenAI, instances };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { GeminiLLMProvider } from "../../src/gemini/provider";

beforeEach(() => {
  openaiMocks.createCompletion.mockClear();
  openaiMocks.createCompletion.mockResolvedValue({
    choices: [
      {
        message: { content: "Final answer" },
      },
    ],
  });
  openaiMocks.instances.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GeminiLLMProvider", () => {
  it("constructs the SDK client with the Gemini OpenAI-compatible baseURL", () => {
    new GeminiLLMProvider({
      apiKey: "gemini-key",
      dangerouslyAllowBrowser: true,
    });

    expect(openaiMocks.instances[0]!.config).toMatchObject({
      apiKey: "gemini-key",
      dangerouslyAllowBrowser: true,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  });

  it("throws CharivoStateError when constructed in a browser without opting in", () => {
    vi.stubGlobal("window", {});

    expect(() => new GeminiLLMProvider({ apiKey: "gemini-key" })).toThrow(
      "Gemini LLM provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
    );
  });

  it("uses default model 'gemini-3.5-flash-lite' when not specified", async () => {
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([{ role: "user", content: "hi" }]);

    expect(openaiMocks.createCompletion.mock.calls[0]![0].model).toBe(
      "gemini-3.5-flash-lite",
    );
  });

  it("omits temperature and reasoning_effort when no temperature is configured", async () => {
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([{ role: "user", content: "hi" }]);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("reasoning_effort");
    expect(payload.max_tokens).toBe(1000);
  });

  it("forwards configured model, temperature (including 0), and maxTokens", async () => {
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      model: "custom-model",
      temperature: 0,
      maxTokens: 500,
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([{ role: "user", content: "hi" }]);

    expect(openaiMocks.createCompletion).toHaveBeenCalledWith({
      model: "custom-model",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
      max_tokens: 500,
    });
  });

  it("passes plain messages through unchanged", async () => {
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    const history = [
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "hi" },
    ];

    await provider.generateResponse(history);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.messages).toEqual(history);
  });

  it("wraps request failures as CharivoProviderError", async () => {
    const error = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    openaiMocks.createCompletion.mockRejectedValueOnce(error);
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
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
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    const request = provider.generateResponse([
      { role: "user", content: "hi" },
    ]);
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini LLM request timed out after 30000ms",
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

const timeTool: ToolDefinition = {
  type: "function",
  name: "get_time",
  description: "Look up the time",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

describe("GeminiLLMProvider.generateResponseWithTools", () => {
  it("attaches the thought_signature skip placeholder to only the first tool call of each assistant tool-call turn", async () => {
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponseWithTools(
      [
        { role: "system", content: "You are Hiyori" },
        { role: "user", content: "weather and time in Seoul, then Busan?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", name: "get_weather", arguments: { city: "Seoul" } },
            { id: "call_2", name: "get_time", arguments: { city: "Seoul" } },
          ],
        },
        { role: "tool", content: '{"temp":21}', toolCallId: "call_1" },
        { role: "tool", content: '{"time":"09:00"}', toolCallId: "call_2" },
        { role: "assistant", content: "Got it, anything else?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_3", name: "get_weather", arguments: { city: "Busan" } },
          ],
        },
      ],
      [weatherTool, timeTool],
    );

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "weather and time in Seoul, then Busan?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Seoul"}' },
            extra_content: {
              google: { thought_signature: "skip_thought_signature_validator" },
            },
          },
          {
            id: "call_2",
            type: "function",
            function: { name: "get_time", arguments: '{"city":"Seoul"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"temp":21}' },
      { role: "tool", tool_call_id: "call_2", content: '{"time":"09:00"}' },
      { role: "assistant", content: "Got it, anything else?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_3",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Busan"}' },
            extra_content: {
              google: { thought_signature: "skip_thought_signature_validator" },
            },
          },
        ],
      },
    ]);
  });

  it("maps tool definitions onto the tools payload", async () => {
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponseWithTools(
      [{ role: "user", content: "weather?" }],
      [weatherTool],
    );

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
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
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponseWithTools(
      [{ role: "user", content: "wrap up" }],
      [],
    );

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("tools");
  });

  it("returns the tool calls requested by the model with decoded arguments", async () => {
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
    const provider = new GeminiLLMProvider({
      apiKey: "key",
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

    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    await expect(
      provider.generateResponseWithTools(
        [{ role: "user", content: "hi" }],
        [weatherTool],
      ),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "timeout",
    });
  });

  it("propagates timeout errors without provider wrapping", async () => {
    vi.useFakeTimers();
    openaiMocks.createCompletion.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const provider = new GeminiLLMProvider({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });

    const request = provider.generateResponseWithTools(
      [{ role: "user", content: "hi" }],
      [weatherTool],
    );
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini LLM request timed out after 30000ms",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });
});
