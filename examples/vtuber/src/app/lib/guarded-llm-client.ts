import type { LLMClient, LLMMessage } from "@charivo/core";
import { hasEnvelopeTag } from "../../director";

export const ENVELOPE_TAG_REPLY_MESSAGE =
  "Reply withheld: it contained an envelope tag";

export const STAGE_DIRECTION_REPLY_MESSAGE =
  "Reply withheld: it repeated a stage direction";

const CUE_TAG = "[DIRECTOR]";
// A cue shorter than this must appear whole; a longer one is matched by any
// run of this many characters, so a partial quote is caught too.
const CUE_MATCH_CHARS = 30;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Only [DIRECTOR] cues: a reply reacting to an [EVENT] or [CHAT] naturally
// reuses its words, but a cue is private and must never be repeated.
function directorCues(messages: LLMMessage[]): string[] {
  return messages
    .filter((m) => m.role === "user" && m.content.startsWith(CUE_TAG))
    .map((m) => normalize(m.content.slice(CUE_TAG.length)))
    .filter((cue) => cue !== "");
}

function repeatsCue(reply: string, cues: string[]): boolean {
  const text = normalize(reply);
  return cues.some((cue) => {
    if (cue.length <= CUE_MATCH_CHARS) return text.includes(cue);
    for (let i = 0; i + CUE_MATCH_CHARS <= cue.length; i++) {
      if (text.includes(cue.slice(i, i + CUE_MATCH_CHARS))) return true;
    }
    return false;
  });
}

function checked(reply: string, messages: LLMMessage[]): string {
  if (hasEnvelopeTag(reply)) throw new Error(ENVELOPE_TAG_REPLY_MESSAGE);
  if (repeatsCue(reply, directorCues(messages))) {
    throw new Error(STAGE_DIRECTION_REPLY_MESSAGE);
  }
  return reply;
}

/**
 * Charivo has no hook between the LLM reply and the TTS, so the reply is
 * checked here, before it returns to Charivo: a reply carrying an envelope tag
 * or repeating a [DIRECTOR] cue from the request verbatim throws, the line is
 * reported failed, and nothing is spoken. A paraphrase of a cue still gets
 * through. Tool-call rounds pass through, since only a final reply is spoken.
 */
export function withEnvelopeTagGuard(client: LLMClient): LLMClient {
  const { callWithTools } = client;
  return {
    call: async (messages, options) =>
      checked(await client.call(messages, options), messages),
    ...(callWithTools && {
      callWithTools: async (messages, tools, options) => {
        const result = await callWithTools.call(
          client,
          messages,
          tools,
          options,
        );
        if (!result.toolCalls?.length) checked(result.content, messages);
        return result;
      },
    }),
  };
}
