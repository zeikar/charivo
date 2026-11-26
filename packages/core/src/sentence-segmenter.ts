export interface SentenceSegment {
  /** The segment's text, trimmed. */
  text: string;
  /** End offset of the segment's span in the accumulated text (exclusive, before trailing whitespace). */
  end: number;
}

export interface SentenceSegmenter {
  /** Adds a chunk and returns the segments it confirmed, in order. */
  push(chunk: string): SentenceSegment[];
  /** Returns the segment left in the buffer, if speakable, and resets. */
  flush(): SentenceSegment[];
}

const TERMINATORS = new Set([".", "!", "?", "…"]);
const CJK_TERMINATORS = new Set(["。", "！", "？"]);
const CLOSERS = new Set([
  '"',
  "'",
  "”",
  "’",
  ")",
  "]",
  "}",
  "»",
  "」",
  "』",
  "）",
  "】",
]);
const SPEAKABLE = /[\p{L}\p{N}]/u;

export function createSentenceSegmenter(): SentenceSegmenter {
  let all = "";
  // Start of the span not yet emitted, and where scanning resumes.
  let spanStart = 0;
  let scan = 0;

  const drain = (final: boolean): SentenceSegment[] => {
    const out: SentenceSegment[] = [];

    // A span with no letter or digit is not cut here, so it joins the next one.
    const cutAt = (end: number) => {
      const span = all.slice(spanStart, end);
      if (SPEAKABLE.test(span)) {
        out.push({ text: span.trim(), end: spanStart + span.trimEnd().length });
        spanStart = end;
      }
    };

    let i = scan;
    while (i < all.length) {
      const c = all[i];
      if (c === "\n") {
        cutAt(i);
        i++;
      } else if (CJK_TERMINATORS.has(c)) {
        let j = i;
        while (
          j < all.length &&
          (CJK_TERMINATORS.has(all[j]) || TERMINATORS.has(all[j]))
        ) {
          j++;
        }
        while (j < all.length && CLOSERS.has(all[j])) j++;
        // No whitespace is needed after these, but the run may still grow.
        if (j === all.length) break;
        cutAt(j);
        i = j;
      } else if (TERMINATORS.has(c)) {
        let j = i;
        while (j < all.length && TERMINATORS.has(all[j])) j++;
        while (j < all.length && CLOSERS.has(all[j])) j++;
        if (j === all.length) {
          // Not confirmed until the next character arrives, or at flush.
          break;
        }
        if (/\s/.test(all[j])) cutAt(j);
        i = j;
      } else {
        i++;
      }
    }
    scan = i;

    if (final) {
      const rest = all.slice(spanStart);
      if (SPEAKABLE.test(rest)) {
        out.push({
          text: rest.trim(),
          end: spanStart + rest.trimEnd().length,
        });
      }
      all = "";
      spanStart = 0;
      scan = 0;
    }
    return out;
  };

  return {
    push(chunk) {
      all += chunk;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}
