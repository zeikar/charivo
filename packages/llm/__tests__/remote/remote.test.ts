import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CharivoTimeoutError,
  CharivoTransportError,
  type LLMMessage,
  type ToolDefinition,
} from "@charivo/core";
import { createRemoteLLMClient } from "@charivo/llm/remote";

const originalFetch = globalThis.fetch;
const createAbortError = () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RemoteLLMClient", () => {
  it("calls the configured endpoint and returns message", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, message: "hi there" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createRemoteLLMClient({ apiEndpoint: "/api/chat" });
    const result = await client.call([{ role: "user", content: "hello" }]);

    expect(result).toBe("hi there");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when API responds with error status", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          statusText: "Server Error",
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createRemoteLLMClient();

    await expect(client.call([])).rejects.toThrow("API call failed: nope");
    errorSpy.mockRestore();
  });

  it("throws when API indicates failure", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, error: "bad request" }), {
          status: 200,
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createRemoteLLMClient();
    await expect(client.call([])).rejects.toThrow("bad request");
    errorSpy.mockRestore();
  });

  it("throws a timeout-specific error when the request is aborted", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const client = createRemoteLLMClient();
    const request = client.call([]);
    const expectation = expect(request).rejects.toThrow(
      "LLM request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });

  it("preserves non-timeout fetch errors", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const client = createRemoteLLMClient();
    const request = client.call([]);

    await expect(request).rejects.toBeInstanceOf(CharivoTransportError);
    await expect(request).rejects.toMatchObject({
      message: "LLM request failed",
      cause: expect.objectContaining({
        message: "network down",
      }),
    });
  });

  it("aborts the underlying fetch and rejects with the abort reason (not a timeout error) when the caller's signal aborts mid-request", async () => {
    const controller = new AbortController();
    let signalGivenToFetch: AbortSignal | undefined;
    const abortError = createAbortError();

    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        signalGivenToFetch = init?.signal ?? undefined;
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(abortError);
          });
        });
      },
    ) as typeof fetch;

    const client = createRemoteLLMClient();
    const request = client.call([], { signal: controller.signal });

    controller.abort();

    expect(signalGivenToFetch?.aborted).toBe(true);
    await expect(request).rejects.toBe(abortError);
    await expect(request).rejects.not.toBeInstanceOf(CharivoTimeoutError);
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

const toolMessages: LLMMessage[] = [
  { role: "system", content: "You are Hiyori" },
  { role: "user", content: "weather?" },
];

function mockJsonResponse(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  globalThis.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

describe("RemoteLLMClient.callWithTools", () => {
  it("posts the messages and the tool definitions", async () => {
    const fetchMock = mockJsonResponse({ success: true, message: "hi there" });

    const client = createRemoteLLMClient({ apiEndpoint: "/api/chat" });
    const response = await client.callWithTools!(toolMessages, [weatherTool]);

    expect(response).toEqual({ content: "hi there" });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/chat");
    expect(JSON.parse(init.body as string)).toEqual({
      messages: toolMessages,
      tools: [weatherTool],
    });
  });

  it("sends an empty tools array through unchanged", async () => {
    const fetchMock = mockJsonResponse({ success: true, message: "done" });

    const client = createRemoteLLMClient();
    await client.callWithTools!(toolMessages, []);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      messages: toolMessages,
      tools: [],
    });
  });

  it("returns the tool calls from the server response", async () => {
    mockJsonResponse({
      success: true,
      message: "",
      toolCalls: [
        { id: "call_1", name: "get_weather", arguments: { city: "Seoul" } },
      ],
    });

    const client = createRemoteLLMClient();
    const response = await client.callWithTools!(toolMessages, [weatherTool]);

    expect(response).toEqual({
      content: "",
      toolCalls: [
        { id: "call_1", name: "get_weather", arguments: { city: "Seoul" } },
      ],
    });
  });

  it("omits toolCalls when the server returns none", async () => {
    mockJsonResponse({ success: true, message: "plain answer" });

    const client = createRemoteLLMClient();
    const response = await client.callWithTools!(toolMessages, [weatherTool]);

    expect(response).not.toHaveProperty("toolCalls");
  });

  it("omits toolCalls when the server returns an empty array", async () => {
    mockJsonResponse({
      success: true,
      message: "plain answer",
      toolCalls: [],
    });

    const client = createRemoteLLMClient();
    const response = await client.callWithTools!(toolMessages, [weatherTool]);

    expect(response).not.toHaveProperty("toolCalls");
  });

  it("rejects a non-object response envelope", async () => {
    mockJsonResponse(null);

    const client = createRemoteLLMClient();

    await expect(
      client.callWithTools!(toolMessages, [weatherTool]),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      message: expect.stringContaining("Malformed response body"),
    });
  });

  it.each([
    ["success is missing", { message: "hi" }, "Failed to generate response"],
    [
      "success is false",
      { success: false, message: "hi" },
      "Failed to generate response",
    ],
    [
      "success is not a boolean",
      { success: "yes", message: "hi" },
      "Failed to generate response",
    ],
    ["message is missing", { success: true }, '"message"'],
    ["message is not a string", { success: true, message: 42 }, '"message"'],
    [
      "toolCalls is not an array",
      { success: true, message: "", toolCalls: { id: "call_1" } },
      '"toolCalls"',
    ],
    [
      "a tool call has no id",
      {
        success: true,
        message: "",
        toolCalls: [{ name: "get_weather", arguments: {} }],
      },
      '"id"',
    ],
    [
      "a tool call has no name",
      {
        success: true,
        message: "",
        toolCalls: [{ id: "call_1", arguments: {} }],
      },
      '"name"',
    ],
    [
      "a tool call has non-object arguments",
      {
        success: true,
        message: "",
        toolCalls: [{ id: "call_1", name: "get_weather", arguments: [1] }],
      },
      '"arguments"',
    ],
  ])("rejects the response when %s", async (_label, body, field) => {
    mockJsonResponse(body);

    const client = createRemoteLLMClient();

    await expect(
      client.callWithTools!(toolMessages, [weatherTool]),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      message: expect.stringContaining(field),
    });
  });

  it("surfaces HTTP failures as provider errors", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          statusText: "Server Error",
        }),
    ) as typeof fetch;

    const client = createRemoteLLMClient();

    await expect(
      client.callWithTools!(toolMessages, [weatherTool]),
    ).rejects.toThrow("API call failed: nope");
  });

  it("preserves non-timeout fetch errors", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const client = createRemoteLLMClient();

    await expect(
      client.callWithTools!(toolMessages, [weatherTool]),
    ).rejects.toBeInstanceOf(CharivoTransportError);
  });
});
