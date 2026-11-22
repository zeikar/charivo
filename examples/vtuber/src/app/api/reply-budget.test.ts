import { describe, expect, it } from "vitest";
import { parseChatRequest } from "./chat-request";
import {
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_REPLY_MAX_CHARS,
  SHOW_MAX_HISTORY_TURNS,
  TOOL_LOOP_ROUNDS,
} from "./demo-limits";
import { boundReply } from "./reply-budget";

describe("boundReply", () => {
  it("leaves a reply within budget alone", () => {
    expect(boundReply("Short reply.", 50)).toBe("Short reply.");
  });

  it("cuts at the last sentence end", () => {
    expect(boundReply("One two three. Four five six seven.", 25)).toBe(
      "One two three.",
    );
  });

  it("falls back to a word boundary, then a hard cut", () => {
    expect(boundReply("alpha beta gamma delta", 14)).toBe("alpha beta");
    expect(boundReply("abcdefghijklmnop", 8)).toBe("abcdefgh");
  });

  it("does not split a surrogate pair", () => {
    expect(boundReply("ab😀😀😀", 3)).toBe("ab");
  });
});

describe("CHAT_REPLY_MAX_CHARS", () => {
  it("is within the per-message limit", () => {
    expect(CHAT_REPLY_MAX_CHARS).toBeLessThanOrEqual(CHAT_MAX_MESSAGE_CHARS);
  });

  it("keeps a full history of max-size replies plus tool rounds acceptable", () => {
    const reply = boundReply("x ".repeat(CHAT_MAX_MESSAGE_CHARS));
    expect(reply.length).toBeLessThanOrEqual(CHAT_REPLY_MAX_CHARS);
    const messages: unknown[] = [
      { role: "system", content: "s".repeat(6_000) },
    ];
    for (let turn = 0; turn < SHOW_MAX_HISTORY_TURNS; turn++) {
      messages.push({ role: "user", content: "u".repeat(400) });
      messages.push({ role: "assistant", content: reply });
    }
    for (let round = 0; round < TOOL_LOOP_ROUNDS; round++) {
      const calls = Array.from({ length: 4 }, (_, i) => ({
        id: `c${round}-${i}`,
        name: "setExpression",
        arguments: {},
      }));
      messages.push({ role: "assistant", content: reply, toolCalls: calls });
      for (const call of calls) {
        messages.push({
          role: "tool",
          content: "t".repeat(200),
          toolCallId: call.id,
        });
      }
    }

    expect(parseChatRequest({ messages })).toMatchObject({ success: true });
  });
});
