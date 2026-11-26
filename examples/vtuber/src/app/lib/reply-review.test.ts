import {
  createCharivo,
  type LLMClient,
  type LLMMessage,
  type Message,
} from "@charivo/core";
import { createCascadeBrain, createLLMManager } from "@charivo/llm";
import { describe, expect, it } from "vitest";
import { reviewReply, STAGE_DIRECTION_REPLY_MESSAGE } from "./reply-review";

function direction(content: string): Message {
  return {
    id: `d-${content.length}`,
    content,
    timestamp: new Date(0),
    type: "direction",
  };
}

function review(text: string, directions: Message[]) {
  return () => reviewReply({ reply: { text }, directions });
}

describe("reviewReply", () => {
  const cue =
    "The stream is ending. Thank the viewers for hanging out and say a warm goodbye.";

  it.each([
    cue,
    `  ${cue.toUpperCase()}  `,
    `Okay: "thank the viewers for   hanging out" and so on`,
  ])("withholds a reply that repeats a direction: %s", (reply) => {
    expect(review(reply, [direction(cue)])).toThrow(
      STAGE_DIRECTION_REPLY_MESSAGE,
    );
  });

  it("withholds a repeated short direction only when it appears whole", () => {
    const short = [direction("Say hi.")];
    expect(review("Well, say hi!", short)).toThrow(
      STAGE_DIRECTION_REPLY_MESSAGE,
    );
    expect(review("Hi, say it again", short)()).toEqual({
      text: "Hi, say it again",
    });
  });

  it("passes an ordinary reply that shares a few words with a direction", () => {
    const reply = "Thank you all for hanging out, it was a warm stream. Bye!";
    expect(review(reply, [direction(cue)])()).toEqual({ text: reply });
  });

  it("passes every reply when there are no directions", () => {
    expect(review(cue, [])()).toEqual({ text: cue });
  });

  it("passes the reply on as given, affect included", () => {
    const reply = { text: "Hello!", affect: { expression: "F01" } };
    expect(reviewReply({ reply, directions: [] })).toBe(reply);
  });
});

describe("reviewReply on a cascade brain", () => {
  it("passes a reply reusing the words of a user or event entry", async () => {
    const words = "A dragon appeared near the castle gate";
    const requests: LLMMessage[][] = [];
    const client: LLMClient = {
      async call(messages) {
        requests.push(messages);
        return `${words}, wow!`;
      },
    };
    const brain = createCascadeBrain(
      createLLMManager(client, { directionRole: "user" }),
      { review: reviewReply },
    );
    createCharivo({
      brain,
      character: { id: "haru", name: "Haru" },
    });

    const results = [];
    for (const input of [
      { kind: "user", speaker: "rin", text: words },
      { kind: "event", source: "game", text: words, respond: "must" },
      { kind: "direction", text: "Keep the energy up." },
    ] as const) {
      results.push(await brain.submit(input).done);
    }

    expect(results.map((result) => result.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    // The last request carried both entries, then the direction.
    const reply = `${words}, wow!`;
    expect(requests.at(-1)?.slice(1)).toEqual([
      { role: "user", content: `rin: ${words}` },
      { role: "assistant", content: reply },
      { role: "user", content: `<event source="game">${words}</event>` },
      { role: "assistant", content: reply },
      {
        role: "user",
        content: expect.stringMatching(
          /^\[Stage direction .*\] Keep the energy up\.$/,
        ),
      },
    ]);
  });
});
