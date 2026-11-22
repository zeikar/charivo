import type { LLMClient, LLMMessage } from "@charivo/core";
import { describe, expect, it, vi } from "vitest";
import {
  ENVELOPE_TAG_REPLY_MESSAGE,
  STAGE_DIRECTION_REPLY_MESSAGE,
  withEnvelopeTagGuard,
} from "./guarded-llm-client";

function inner(reply: string, toolCalls?: { id: string }[]): LLMClient {
  return {
    call: vi.fn().mockResolvedValue(reply),
    callWithTools: vi.fn().mockResolvedValue({ content: reply, toolCalls }),
  } as unknown as LLMClient;
}

describe("withEnvelopeTagGuard", () => {
  it("passes a clean reply through unchanged", async () => {
    const guarded = withEnvelopeTagGuard(inner("Hello there!"));
    await expect(guarded.call([])).resolves.toBe("Hello there!");
    await expect(guarded.callWithTools?.([], [])).resolves.toEqual({
      content: "Hello there!",
      toolCalls: undefined,
    });
  });

  it.each(["[DIRECTOR] say hi", "ok [chat] x", "so [Event] happened"])(
    "withholds a final reply containing a tag: %s",
    async (reply) => {
      const guarded = withEnvelopeTagGuard(inner(reply));
      await expect(guarded.call([])).rejects.toThrow(
        ENVELOPE_TAG_REPLY_MESSAGE,
      );
      await expect(guarded.callWithTools?.([], [])).rejects.toThrow(
        ENVELOPE_TAG_REPLY_MESSAGE,
      );
    },
  );

  it("passes a tool-call round through even when its text has a tag", async () => {
    const result = await withEnvelopeTagGuard(
      inner("[DIRECTOR] thinking", [{ id: "1" }]),
    ).callWithTools?.([], []);
    expect(result?.toolCalls).toHaveLength(1);
  });

  it("forwards the arguments and omits callWithTools when the client has none", async () => {
    const base = inner("hi");
    const signal = new AbortController().signal;
    await withEnvelopeTagGuard(base).call([], { signal });
    expect(base.call).toHaveBeenCalledWith([], { signal });

    const plain = withEnvelopeTagGuard({ call: base.call });
    expect(plain.callWithTools).toBeUndefined();
  });
});

describe("withEnvelopeTagGuard: stage directions", () => {
  const cue =
    "The stream is ending. Thank the viewers for hanging out and say a warm goodbye.";
  const messages: LLMMessage[] = [
    { role: "user", content: `[DIRECTOR] ${cue}` },
  ];

  it.each([
    cue,
    `  ${cue.toUpperCase()}  `,
    `Okay: "thank the viewers for   hanging out" and so on`,
  ])("withholds a reply that repeats the cue: %s", async (reply) => {
    const guarded = withEnvelopeTagGuard(inner(reply));
    await expect(guarded.call(messages)).rejects.toThrow(
      STAGE_DIRECTION_REPLY_MESSAGE,
    );
    await expect(guarded.callWithTools?.(messages, [])).rejects.toThrow(
      STAGE_DIRECTION_REPLY_MESSAGE,
    );
  });

  it("withholds a repeated short cue only when it appears whole", async () => {
    const short: LLMMessage[] = [
      { role: "user", content: "[DIRECTOR] Say hi." },
    ];
    await expect(
      withEnvelopeTagGuard(inner("Well, say hi!")).call(short),
    ).rejects.toThrow(STAGE_DIRECTION_REPLY_MESSAGE);
    await expect(
      withEnvelopeTagGuard(inner("Hi, say it again")).call(short),
    ).resolves.toBe("Hi, say it again");
  });

  it("passes an ordinary reply that shares a few words with the cue", async () => {
    const reply = "Thank you all for hanging out, it was a warm stream. Bye!";
    await expect(
      withEnvelopeTagGuard(inner(reply)).call(messages),
    ).resolves.toBe(reply);
  });

  it("does not match the text of an event or chat message", async () => {
    const reply = "A dragon appeared near the castle gate, wow!";
    const other: LLMMessage[] = [
      {
        role: "user",
        content: "[EVENT] game: A dragon appeared near the castle gate",
      },
      {
        role: "user",
        content: "[CHAT] rin: a dragon appeared near the castle gate",
      },
    ];
    await expect(withEnvelopeTagGuard(inner(reply)).call(other)).resolves.toBe(
      reply,
    );
  });
});
