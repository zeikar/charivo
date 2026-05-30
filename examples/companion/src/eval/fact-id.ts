import type { MemoryScope, MemoryFactKind } from "../memory/types";

/**
 * Mirror of `promote.ts`'s deterministic fact-id derivation (`normalize` + the
 * djb2 `hashId`). The eval harness must compute the SAME id the promotion
 * pipeline persists, so fixtures assert by computed id — never by string match.
 *
 * MUST stay byte-identical to `promote.ts`'s `hashId`/`normalize` and id-source
 * tuple. The duplication is intentional, NOT a DRY violation: if that formula
 * drifts, the eval SHOULD break loudly (the computed expected ids stop matching
 * what the pipeline writes).
 */

/** Collapse whitespace + lowercase. Byte-identical to promote.ts `normalize`. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** djb2-style hash → unsigned hex, `fact_` prefix. Byte-identical to promote.ts. */
function hashId(source: string): string {
  let h = 0;
  for (let i = 0; i < source.length; i++) {
    h = (Math.imul(h, 31) + source.charCodeAt(i)) | 0;
  }
  return `fact_${(h >>> 0).toString(16)}`;
}

/**
 * The deterministic id `promoteSession` would assign to `candidate` under
 * `scope`. The id-source tuple order MUST match promote.ts:
 * `[userId, characterId, sourceTurnId, kind, normalize(text)]`.
 */
export function expectedFactId(
  scope: MemoryScope,
  candidate: { sourceTurnId: string; kind: MemoryFactKind; text: string },
): string {
  const idSource = JSON.stringify([
    scope.userId,
    scope.characterId,
    candidate.sourceTurnId,
    candidate.kind,
    normalize(candidate.text),
  ]);
  return hashId(idSource);
}
