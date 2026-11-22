import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_REPLY_MAX_CHARS, TOOL_CALLS_PER_ROUND } from "../demo-limits";

const generateResponse = vi.fn();
const generateResponseWithTools = vi.fn();
vi.mock("@charivo/server/gemini", () => ({
  createGeminiLLMProvider: () => ({
    generateResponse,
    generateResponseWithTools,
  }),
}));

import { POST } from "./route";

function post(
  headers: Record<string, string>,
  body: unknown = { messages: [{ role: "user", content: "hi" }] },
) {
  return POST(
    new NextRequest("http://127.0.0.1:3002/api/chat", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const JSON_HEADERS = { "content-type": "application/json" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  generateResponse.mockResolvedValue("Hello!");
});

describe("POST /api/chat: caller checks", () => {
  it.each(["text/plain", "application/x-www-form-urlencoded", ""])(
    "rejects content type %j with 415 before reading the body",
    async (contentType) => {
      const response = await post(
        contentType ? { "content-type": contentType } : {},
      );
      expect(response.status).toBe(415);
      expect(generateResponse).not.toHaveBeenCalled();
    },
  );

  it.each(["https://evil.example", "http://127.0.0.1:3000", "null"])(
    "rejects origin %s with 403",
    async (origin) => {
      const response = await post({ ...JSON_HEADERS, origin });
      expect(response.status).toBe(403);
      expect(generateResponse).not.toHaveBeenCalled();
    },
  );

  it.each<Record<string, string>>([
    {},
    { origin: "http://127.0.0.1:3002" },
    { origin: "http://localhost:3002" },
  ])("accepts JSON from %j", async (extra) => {
    const response = await post({
      "content-type": "application/json; charset=utf-8",
      ...extra,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: "Hello!" });
  });
});

describe("POST /api/chat: reply bound", () => {
  it("truncates an over-budget reply on both paths", async () => {
    const long = "Word. ".repeat(CHAT_REPLY_MAX_CHARS);
    generateResponse.mockResolvedValue(long);
    generateResponseWithTools.mockResolvedValue({ content: long });

    const plain = await (await post(JSON_HEADERS)).json();
    const tools = await (
      await post(JSON_HEADERS, {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      })
    ).json();

    for (const { message } of [plain, tools]) {
      expect(message.length).toBeLessThanOrEqual(CHAT_REPLY_MAX_CHARS);
      expect(message.endsWith("Word.")).toBe(true);
    }
  });
});

describe("POST /api/chat: tool calls", () => {
  it("keeps only the first TOOL_CALLS_PER_ROUND calls of a round", async () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      name: "setExpression",
      arguments: {},
    }));
    generateResponseWithTools.mockResolvedValue({
      content: "",
      toolCalls: calls,
    });
    const body = await (
      await post(JSON_HEADERS, {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      })
    ).json();
    expect(body.toolCalls).toEqual(calls.slice(0, TOOL_CALLS_PER_ROUND));
  });
});
