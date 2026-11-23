import { describe, expect, it } from "vitest";
import { parseChatRequest } from "./chat-request";
import {
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_MAX_MESSAGES,
  CHAT_MAX_TOOL_CALL_ID_CHARS,
  CHAT_MAX_TOOL_CALLS_BYTES,
  CHAT_MAX_TOOL_CALLS_PER_MESSAGE,
  CHAT_MAX_TOOLS,
  CHAT_MAX_TOOLS_BYTES,
  CHAT_MAX_TOTAL_CHARS,
  SHOW_MAX_HISTORY_TURNS,
  TOOL_LOOP_ROUNDS,
} from "./demo-limits";

const noopTool = {
  type: "function",
  name: "noop",
  description: "",
  parameters: { type: "object", properties: {} },
};

describe("parseChatRequest size bounds", () => {
  it("rejects more messages than the cap", () => {
    const result = parseChatRequest({
      messages: Array.from({ length: CHAT_MAX_MESSAGES + 1 }, () => ({
        role: "user",
        content: "hi",
      })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a message past the per-message cap", () => {
    const result = parseChatRequest({
      messages: [
        { role: "user", content: "x".repeat(CHAT_MAX_MESSAGE_CHARS + 1) },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a conversation past the total-character cap", () => {
    const count = Math.floor(CHAT_MAX_TOTAL_CHARS / CHAT_MAX_MESSAGE_CHARS) + 1;
    const result = parseChatRequest({
      messages: Array.from({ length: count }, () => ({
        role: "user",
        content: "x".repeat(CHAT_MAX_MESSAGE_CHARS),
      })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects more tools than the cap", () => {
    const result = parseChatRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: Array.from({ length: CHAT_MAX_TOOLS + 1 }, () => noopTool),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tool schema that is large despite a legal entry count", () => {
    const result = parseChatRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { ...noopTool, description: "x".repeat(CHAT_MAX_TOOLS_BYTES + 1) },
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

  it("rejects oversized tool-call arguments", () => {
    const result = parseChatRequest({
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "noop",
              arguments: { blob: "x".repeat(CHAT_MAX_TOOL_CALLS_BYTES) },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an oversized toolCallId", () => {
    const result = parseChatRequest({
      messages: [
        {
          role: "tool",
          content: "{}",
          toolCallId: "x".repeat(CHAT_MAX_TOOL_CALL_ID_CHARS + 1),
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("parseChatRequest shape validation", () => {
  it("rejects a non-object body", () => {
    expect(parseChatRequest([]).success).toBe(false);
    expect(parseChatRequest(null).success).toBe(false);
  });

  it("rejects a missing messages array", () => {
    expect(parseChatRequest({}).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const result = parseChatRequest({
      messages: [{ role: "function", content: "hi" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects toolCalls on a user turn", () => {
    const result = parseChatRequest({
      messages: [
        {
          role: "user",
          content: "hi",
          toolCalls: [{ id: "c", name: "noop", arguments: {} }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tool turn without a toolCallId", () => {
    const result = parseChatRequest({
      messages: [{ role: "tool", content: "{}" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tool definition whose parameters are not an object schema", () => {
    const result = parseChatRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ ...noopTool, parameters: { type: "string" } }],
    });
    expect(result.success).toBe(false);
  });

  it("defaults an omitted tools key to an empty list", () => {
    const result = parseChatRequest({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result).toEqual({
      success: true,
      value: { messages: [{ role: "user", content: "hi" }], tools: [] },
    });
  });
});

describe("a full show request", () => {
  it("accepts a full history plus a three-round tool loop", () => {
    const history = Array.from({ length: SHOW_MAX_HISTORY_TURNS }, (_, i) => [
      { role: "user", content: `viewer line ${i}` },
      { role: "assistant", content: `Haru line ${i}` },
    ]).flat();

    // Each round: an assistant turn with calls, then one tool result per call.
    const loop = Array.from({ length: TOOL_LOOP_ROUNDS }, (_, round) => [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: `r${round}a`, name: "setExpression", arguments: { id: "F01" } },
          {
            id: `r${round}b`,
            name: "playMotion",
            arguments: { group: "Idle" },
          },
        ],
      },
      { role: "tool", content: "{}", toolCallId: `r${round}a` },
      { role: "tool", content: "{}", toolCallId: `r${round}b` },
    ]).flat();

    const result = parseChatRequest({
      messages: [
        { role: "system", content: "You are Haru." },
        ...history,
        ...loop,
      ],
      tools: [noopTool],
    });

    expect(result.success).toBe(true);
  });
});
