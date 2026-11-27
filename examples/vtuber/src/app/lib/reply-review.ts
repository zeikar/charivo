import type { CascadeReply, CascadeReviewInput } from "@charivo/llm";

export const STAGE_DIRECTION_REPLY_MESSAGE =
  "Reply withheld: it repeated a stage direction";

// A cue shorter than this must appear whole; a longer one is matched by any
// run of this many characters, so a partial quote is caught too.
const CUE_MATCH_CHARS = 30;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
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

/**
 * The cascade brain's `review`: a reply repeating a stage direction of its
 * request verbatim throws, so the line fails and nothing is spoken. A
 * paraphrase still gets through. The brain hands over `direction` entries
 * only, so a reply reacting to a viewer or an event can reuse their words.
 */
export function reviewReply({
  reply,
  directions,
}: CascadeReviewInput): CascadeReply {
  const cues = directions
    .map((direction) => normalize(direction.content))
    .filter((cue) => cue !== "");
  if (repeatsCue(reply.text, cues)) {
    throw new Error(STAGE_DIRECTION_REPLY_MESSAGE);
  }
  return reply;
}
