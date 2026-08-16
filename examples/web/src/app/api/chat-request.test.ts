import { describe, expect, it } from "vitest";
import { parseChatRequest, requiresToolCallingPath } from "./chat-request";
import {
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_MAX_MESSAGES,
  CHAT_MAX_TOOL_CALLS_BYTES,
  CHAT_MAX_TOOL_CALLS_PER_MESSAGE,
  CHAT_MAX_TOOLS,
  CHAT_MAX_TOOLS_BYTES,
  CHAT_MAX_TOTAL_CHARS,
} from "./demo-limits";

describe("parseChatRequest", () => {
  describe("accepts", () => {
    it("a plain chat with no tools", () => {
      const result = parseChatRequest({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hi" },
        ],
      });

      expect(result).toEqual({
        success: true,
        value: {
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hi" },
          ],
        },
      });
    });

    it("an assistant turn with tool calls", () => {
      const result = parseChatRequest({
        messages: [
          { role: "user", content: "What's the weather?" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call_1",
                name: "getWeather",
                arguments: { city: "Seoul" },
              },
            ],
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.messages[1]).toEqual({
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", name: "getWeather", arguments: { city: "Seoul" } },
          ],
        });
      }
    });

    it("a tool turn with a toolCallId", () => {
      const result = parseChatRequest({
        messages: [
          { role: "tool", content: '{"temp":20}', toolCallId: "call_1" },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.messages[0]).toEqual({
          role: "tool",
          content: '{"temp":20}',
          toolCallId: "call_1",
        });
      }
    });

    it("tools with a full parameters shape", () => {
      const result = parseChatRequest({
        messages: [{ role: "user", content: "Hi" }],
        tools: [
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
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.tools).toEqual([
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
        ]);
      }
    });

    it("an empty tools array", () => {
      const result = parseChatRequest({
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
      });

      expect(result).toEqual({
        success: true,
        value: { messages: [{ role: "user", content: "Hi" }], tools: [] },
      });
    });
  });

  describe("rejects", () => {
    it("an unknown role", () => {
      const result = parseChatRequest({
        messages: [{ role: "developer", content: "Hi" }],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          'messages[0] has an unknown role: "developer"',
        );
      }
    });

    it("toolCalls on a user turn", () => {
      const result = parseChatRequest({
        messages: [
          {
            role: "user",
            content: "Hi",
            toolCalls: [{ id: "call_1", name: "x", arguments: {} }],
          },
        ],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          'messages[0] with role "user" must not include toolCalls or toolCallId',
        );
      }
    });

    it("a tool turn missing toolCallId", () => {
      const result = parseChatRequest({
        messages: [{ role: "tool", content: "{}" }],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          'messages[0] with role "tool" requires a non-empty string toolCallId',
        );
      }
    });

    it("a tool call with arguments: []", () => {
      const result = parseChatRequest({
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", name: "x", arguments: [] }],
          },
        ],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "messages[0].toolCalls[0].arguments must be a plain object",
        );
      }
    });

    it("a tool call with arguments: null", () => {
      const result = parseChatRequest({
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", name: "x", arguments: null }],
          },
        ],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "messages[0].toolCalls[0].arguments must be a plain object",
        );
      }
    });

    it('parameters missing type: "object"', () => {
      const result = parseChatRequest({
        messages: [{ role: "user", content: "Hi" }],
        tools: [
          {
            type: "function",
            name: "x",
            description: "d",
            parameters: { properties: {} },
          },
        ],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('tools[0].parameters.type must be "object"');
      }
    });

    it("parameters missing properties", () => {
      const result = parseChatRequest({
        messages: [{ role: "user", content: "Hi" }],
        tools: [
          {
            type: "function",
            name: "x",
            description: "d",
            parameters: { type: "object" },
          },
        ],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "tools[0].parameters.properties must be an object",
        );
      }
    });

    it("required containing a non-string", () => {
      const result = parseChatRequest({
        messages: [{ role: "user", content: "Hi" }],
        tools: [
          {
            type: "function",
            name: "x",
            description: "d",
            parameters: {
              type: "object",
              properties: {},
              required: ["a", 1],
            },
          },
        ],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "tools[0].parameters.required must be an array of strings",
        );
      }
    });
  });
});

describe("requiresToolCallingPath", () => {
  it("is false for a tools-less plain conversation", () => {
    expect(
      requiresToolCallingPath({
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).toBe(false);
  });

  it("is true when tools is present, even empty", () => {
    expect(
      requiresToolCallingPath({
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
      }),
    ).toBe(true);
  });

  it("is true for the terminal round: tools: [] with tool turns in messages", () => {
    expect(
      requiresToolCallingPath({
        messages: [
          { role: "user", content: "What's the weather?" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", name: "getWeather", arguments: {} }],
          },
          { role: "tool", content: "{}", toolCallId: "call_1" },
        ],
        tools: [],
      }),
    ).toBe(true);
  });
});

describe("parseChatRequest cost bounds", () => {
  it("rejects more messages than the demo cap", () => {
    const result = parseChatRequest({
      messages: Array.from({ length: CHAT_MAX_MESSAGES + 1 }, () => ({
        role: "user",
        content: "hi",
      })),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a single message past the per-message cap", () => {
    const result = parseChatRequest({
      messages: [
        { role: "user", content: "x".repeat(CHAT_MAX_MESSAGE_CHARS + 1) },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a conversation past the total-character cap", () => {
    const perMessage = "x".repeat(CHAT_MAX_MESSAGE_CHARS);
    const count = Math.floor(CHAT_MAX_TOTAL_CHARS / CHAT_MAX_MESSAGE_CHARS) + 1;

    const result = parseChatRequest({
      messages: Array.from({ length: count }, () => ({
        role: "user",
        content: perMessage,
      })),
    });

    expect(result.success).toBe(false);
  });

  it("rejects more tools than the demo cap", () => {
    const result = parseChatRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: Array.from({ length: CHAT_MAX_TOOLS + 1 }, () => ({
        type: "function",
        name: "noop",
        description: "",
        parameters: { type: "object", properties: {} },
      })),
    });

    expect(result.success).toBe(false);
  });

  it("still accepts a conversation inside every bound", () => {
    const result = parseChatRequest({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a tool schema that is large despite a legal entry count", () => {
    const result = parseChatRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          name: "noop",
          description: "x".repeat(CHAT_MAX_TOOLS_BYTES + 1),
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects more tool calls per message than the cap", () => {
    const result = parseChatRequest({
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: Array.from(
            { length: CHAT_MAX_TOOL_CALLS_PER_MESSAGE + 1 },
            (_, index) => ({
              id: `call_${index}`,
              name: "noop",
              arguments: {},
            }),
          ),
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized tool-call arguments, which no content cap covers", () => {
    const result = parseChatRequest({
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "noop",
              arguments: { blob: "x".repeat(CHAT_MAX_TOOL_CALLS_BYTES + 1) },
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
