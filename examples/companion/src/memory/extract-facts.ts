import type {
  Transcript,
  FactExtractor,
  FactCandidate,
  ExtractResult,
} from "./promotion-types";

/**
 * Runs `extractor.extract(transcript)` and filters the raw candidates.
 *
 * A candidate survives only when BOTH conditions hold:
 *   (a) `sourceTurnId` is a non-empty string that matches an actual USER turn id
 *       in the transcript (assistant-sourced or non-existent ids are discarded
 *       as evidence-less — hallucination filter).
 *   (b) `importance` is a finite number in [0, 1] (NaN, Infinity, and out-of-
 *       range values are rejected).
 *
 * Everything else is dropped; `droppedCount` reflects the total dropped.
 * No embedding or store interaction happens here.
 */
export async function extractFacts(
  transcript: Transcript,
  extractor: FactExtractor,
): Promise<ExtractResult> {
  const raw: FactCandidate[] = await extractor.extract(transcript);

  const userTurnIds = new Set<string>(
    transcript.turns.filter((t) => t.role === "user").map((t) => t.id),
  );

  const candidates: FactCandidate[] = [];
  let droppedCount = 0;

  for (const c of raw) {
    const validSource =
      c.sourceTurnId.length > 0 && userTurnIds.has(c.sourceTurnId);
    const validImportance =
      Number.isFinite(c.importance) && c.importance >= 0 && c.importance <= 1;

    if (validSource && validImportance) {
      candidates.push(c);
    } else {
      droppedCount++;
    }
  }

  return { candidates, droppedCount };
}
