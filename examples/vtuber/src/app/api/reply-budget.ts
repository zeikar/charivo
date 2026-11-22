import { CHAT_REPLY_MAX_CHARS } from "./demo-limits";

/**
 * Shortens an over-budget reply at the last sentence end in its second half,
 * else at the last word boundary, else hard, so what is spoken still ends
 * cleanly and the request that carries it back stays within the limits.
 */
export function boundReply(
  reply: string,
  maxChars: number = CHAT_REPLY_MAX_CHARS,
): string {
  if (reply.length <= maxChars) return reply;
  const head = reply.slice(0, maxChars);
  const floor = Math.floor(maxChars / 2);

  let sentenceEnd = -1;
  for (const match of head.matchAll(/[.!?。！？]["')\]]*(?=\s|$)/g)) {
    sentenceEnd = match.index + match[0].length;
  }
  if (sentenceEnd > floor) return head.slice(0, sentenceEnd);

  const wordEnd = head.search(/\s\S*$/);
  if (wordEnd > floor) return head.slice(0, wordEnd).trimEnd();

  // Not inside a surrogate pair.
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}
