import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_GEMINI_MODEL } from "../demo-limits";

const generateResponse = vi.fn();
const generateResponseWithTools = vi.fn();
const createGeminiLLMProvider = vi.fn(() => ({
  generateResponse,
  generateResponseWithTools,
}));

vi.mock("@charivo/server/gemini", () => ({
  createGeminiLLMProvider: (...args: unknown[]) =>
    createGeminiLLMProvider(...(args as [])),
}));

import { POST } from "./route";

function postRequest(body: string) {
  return new Request("http://localhost/api/chat-gemini", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

describe("examples/web /api/chat-gemini route", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    createGeminiLLMProvider.mockClear();
    generateResponse.mockReset();
    generateResponseWithTools.mockReset();
  });

  it("returns 400 for syntactically invalid JSON without calling the provider", async () => {
    const response = await POST(postRequest("{") as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    });
    expect(createGeminiLLMProvider).not.toHaveBeenCalled();
  });

  it("returns 400 for a structurally malformed body without calling the provider", async () => {
    const response = await POST(
      postRequest(
        JSON.stringify({ messages: [{ role: "tool", content: "{}" }] }),
      ) as never,
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toEqual(expect.stringContaining("toolCallId"));
    expect(createGeminiLLMProvider).not.toHaveBeenCalled();
  });

  it("calls generateResponseWithTools with the parsed tools and returns toolCalls", async () => {
    generateResponseWithTools.mockResolvedValue({
      content: "Let me check.",
      toolCalls: [
        { id: "call_1", name: "getWeather", arguments: { city: "Seoul" } },
      ],
    });

    const messages = [{ role: "user", content: "What's the weather?" }];
    const tools = [
      {
        type: "function",
        name: "getWeather",
        description: "Get the weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ];

    const response = await POST(
      postRequest(JSON.stringify({ messages, tools })) as never,
    );

    expect(generateResponseWithTools).toHaveBeenCalledWith(messages, tools);
    expect(generateResponse).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Let me check.",
      toolCalls: [
        { id: "call_1", name: "getWeather", arguments: { city: "Seoul" } },
      ],
    });
  });

  it("uses today's generateResponse path and response shape when tools is absent", async () => {
    generateResponse.mockResolvedValue("Hello there!");

    const messages = [{ role: "user", content: "Hi" }];

    const response = await POST(
      postRequest(JSON.stringify({ messages })) as never,
    );

    expect(generateResponse).toHaveBeenCalledWith(messages);
    expect(generateResponseWithTools).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Hello there!",
    });
  });

  it("uses generateResponseWithTools on the terminal round (tools: [] with tool turns in messages)", async () => {
    generateResponseWithTools.mockResolvedValue({ content: "It's sunny." });

    const messages = [
      { role: "user", content: "What's the weather?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_1", name: "getWeather", arguments: { city: "Seoul" } },
        ],
      },
      { role: "tool", content: '{"temp":20}', toolCallId: "call_1" },
    ];

    const response = await POST(
      postRequest(JSON.stringify({ messages, tools: [] })) as never,
    );

    expect(generateResponseWithTools).toHaveBeenCalledWith(messages, []);
    expect(generateResponse).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "It's sunny.",
    });
  });

  it("calls the factory with the pinned model", async () => {
    generateResponse.mockResolvedValue("Hi!");

    await POST(
      postRequest(
        JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
      ) as never,
    );

    expect(createGeminiLLMProvider).toHaveBeenCalledWith({
      apiKey: "test-key",
      model: CHAT_GEMINI_MODEL,
    });
  });

  it("fails closed when GEMINI_API_KEY is not configured", async () => {
    delete process.env.GEMINI_API_KEY;

    const response = await POST(
      postRequest(
        JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
      ) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to generate response",
      details: "GEMINI_API_KEY not configured",
    });
    expect(createGeminiLLMProvider).not.toHaveBeenCalled();
  });
});
