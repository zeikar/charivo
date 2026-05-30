import { estimateTokens } from "../memory/scoring";

/**
 * Generic, fixture-agnostic memory-eval metrics. Pure functions over fact-id
 * sets/arrays — NO knowledge of any specific scenario. This is the mechanism
 * half of the mechanism/policy boundary; the product thresholds + fixtures live
 * elsewhere.
 */

export type PrecisionRecall = {
  precision: number;
  recall: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
};

/**
 * Positive-set precision/recall over fact-id sets.
 *   precision = TP / (TP + FP) = |actual ∩ expected| / |actual|
 *   recall    = TP / (TP + FN) = |actual ∩ expected| / |expected|
 *
 * Degenerate-denominator convention (symmetric): a ratio is `1` ONLY when BOTH
 * sets are empty (perfect on a nothing-expected/nothing-admitted case); when
 * exactly one side is empty the ratio is `0`. These cases do not arise in the
 * curated scenarios (expected is always non-empty) — the convention only keeps
 * the math total.
 */
export function precisionRecall(
  actual: Set<string>,
  expected: Set<string>,
): PrecisionRecall {
  let truePositives = 0;
  for (const id of actual) if (expected.has(id)) truePositives++;
  const falsePositives = actual.size - truePositives;
  const falseNegatives = expected.size - truePositives;

  const precision =
    actual.size === 0
      ? expected.size === 0
        ? 1
        : 0
      : truePositives / actual.size;
  const recall =
    expected.size === 0
      ? actual.size === 0
        ? 1
        : 0
      : truePositives / expected.size;

  return { precision, recall, truePositives, falsePositives, falseNegatives };
}

/**
 * Precision@K — fraction of the first K ranked ids that are relevant. Order
 * WITHIN the top K does not matter (use an exact ordered-slice assertion when
 * ordering must be verified). Guards: k ≤ 0 or empty list → 0.
 */
export function precisionAtK(
  rankedIds: string[],
  relevant: Set<string>,
  k: number,
): number {
  if (k <= 0 || rankedIds.length === 0) return 0;
  const topK = rankedIds.slice(0, k);
  let hits = 0;
  for (const id of topK) if (relevant.has(id)) hits++;
  return hits / Math.min(k, rankedIds.length);
}

/**
 * Deletion compliance: every retired id must be gone from the retrievable set.
 * `leaked` = retired ids that are still retrievable; `compliant` when none leak.
 */
export function deletionCompliance(args: {
  retiredIds: string[];
  stillRetrievableIds: Set<string>;
}): { compliant: boolean; leaked: string[] } {
  const leaked = args.retiredIds.filter((id) =>
    args.stillRetrievableIds.has(id),
  );
  return { compliant: leaked.length === 0, leaked };
}

/**
 * Cross-scope isolation: no foreign-scope id may appear in the retrieved set.
 * `leaked` = foreign ids that leaked into retrieval; `isolated` when none leak.
 */
export function crossScopeIsolation(args: {
  foreignExpectedIds: Set<string>;
  retrievedIds: Set<string>;
}): { isolated: boolean; leaked: string[] } {
  const leaked = [...args.foreignExpectedIds].filter((id) =>
    args.retrievedIds.has(id),
  );
  return { isolated: leaked.length === 0, leaked };
}

/**
 * Temporal-correction accuracy: after a correction, the new fact is active and
 * the superseded one is gone. `correct` iff active set has the active id and not
 * the retired id.
 */
export function temporalCorrectionAccuracy(args: {
  expectedActiveId: string;
  expectedRetiredId: string;
  activeIds: Set<string>;
}): { correct: boolean } {
  return {
    correct:
      args.activeIds.has(args.expectedActiveId) &&
      !args.activeIds.has(args.expectedRetiredId),
  };
}

/**
 * Injected-token count for a rendered memory block. Single source of truth — the
 * `text.length / 4` math lives in `scoring.estimateTokens`; we only re-export it
 * so the eval has one named metric entry point.
 */
export function injectedTokenCount(text: string): number {
  return estimateTokens(text);
}
