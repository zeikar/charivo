import { describe, expect, it } from "vitest";
import { parseChatRequest, requiresToolCallingPath } from "./chat-request";

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
