import type {
  FactCandidate,
  FactExtractor,
  Transcript,
} from "../promotion-types";

/**
 * Test-only by convention (lives under `src/memory/__fixtures__/` so it
 * typechecks, but only `*.test.ts` files import it — never reached by
 * production or the Next build).
 *
 * Returns a `FactExtractor` whose `extract` method emits ALL candidates from
 * every script entry (flattened), regardless of which turns appear in the
 * transcript. This makes "emitted but dropped" filter cases real: an entry
 * keyed by an assistant-turn id or a non-existent turn id is still emitted,
 * and `extractFacts` then drops it.
 */
export function createScriptedExtractor(
  scriptByTurnId: Record<string, FactCandidate[]>,
): FactExtractor {
  const allCandidates: FactCandidate[] = Object.values(scriptByTurnId).flat();
  return {
    extract(_transcript: Transcript): Promise<FactCandidate[]> {
      return Promise.resolve(allCandidates);
    },
  };
}
