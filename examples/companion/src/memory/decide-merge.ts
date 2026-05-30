/**
 * Pure merge-decision logic: given a fact candidate and its nearest active
 * neighbors, returns the action (ADD | UPDATE | DELETE | NOOP) the pipeline
 * should take.
 *
 * NO store, NO clock, NO importance threshold — those live elsewhere.
 * This module is deliberately side-effect-free so it can graduate to
 * @charivo/memory without product-policy baggage.
 */

import type { FactCandidate, MergeDecision } from "./promotion-types";
import type { MemoryFact } from "./types";
import { cosineSimilarity } from "./scoring";

// ── Precision dials ────────────────────────────────────────────────────────
//
// DUP_SIMILARITY: cosine >= this means the candidate is effectively identical
// to an existing fact — the new text adds nothing new → NOOP.
// Tune upward to make the duplicate gate stricter (allows more updates).
const DUP_SIMILARITY = 0.92;

// RELATED_SIMILARITY: cosine >= this (but < DUP) means the candidate is on
// the same topic as a neighbor. Combined with isReplacement, signals UPDATE.
// Tune downward to catch more drift; upward to be more conservative.
const RELATED_SIMILARITY = 0.6;

// AMBIGUITY_EPSILON: when the top two neighbors in the UPDATE band are within
// this distance of each other (in cosine similarity), we cannot confidently
// choose a target → NOOP rather than guessing.
const AMBIGUITY_EPSILON = 0.001;

// ── Retraction marker set (M10) ────────────────────────────────────────────
//
// ONLY explicit retraction / forgetting phrases are listed here. Bare
// negation tokens ("not", "don't", "no", "never") are intentionally omitted:
// they appear in legitimate negative-preference facts
// ("I don't like spicy food") that should be ADMITTED, not retracted.
//
// If you add a phrase here, also add a corresponding negative-preference
// counterexample in decide-merge.test.ts so the precision doesn't regress.
const RETRACTION_MARKERS = [
  "no longer",
  "forget that",
  "forget about",
  "stop remembering",
  "scratch that",
  "never mind",
  "used to",
  "don't remember",
] as const;

/**
 * Returns true when `text` contains an explicit retraction or forgetting
 * phrase. Matched against the fixed RETRACTION_MARKERS set — no inference.
 *
 * MVP heuristic: deliberately conservative. False-negatives (undetected
 * retractions) are safer than false-positives (treating a valid negative
 * preference as a retraction).
 */
export function isRetraction(text: string): boolean {
  const lower = text.toLowerCase();
  for (const marker of RETRACTION_MARKERS) {
    if (lower.includes(marker)) return true;
  }
  return false;
}

/**
 * Returns true when `candidate` explicitly replaces `neighbor`.
 *
 * Replacement is anchored to declared extraction metadata, not coincidental
 * token overlap. Both conditions must hold:
 *   1. `candidate.subject` is a non-empty string (supplied by the extractor).
 *   2. The neighbor's text contains that subject as a whole word (case-insensitive).
 *
 * When `candidate.subject` is absent or empty → always false (precision-first;
 * missing metadata means no auto-supersede — prefer ADD over a wrong UPDATE).
 *
 * The kind-equality check is omitted here because `decideMerge` already
 * pre-filters neighbors to the candidate's kind before calling this function.
 */
export function isReplacement(
  candidate: FactCandidate,
  neighbor: MemoryFact,
): boolean {
  const subject = candidate.subject?.trim();
  if (!subject) return false;

  // Whole-word, case-insensitive match of the declared subject in the neighbor text.
  const pattern = new RegExp(
    `\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i",
  );
  return pattern.test(neighbor.text);
}

/**
 * Decide what merge action to take for `candidate` given the top-K active
 * neighbors already fetched by the orchestrator.
 *
 * Decision order (precision-first):
 *   1. Retraction branch — DELETE the best matching neighbor, or NOOP if no
 *      active match. Never ADDs (B4 idempotency: a re-run after a correction
 *      finds the target already inactive and does nothing).
 *   2. Assertion branch — ADD (no neighbors), NOOP (duplicate), UPDATE
 *      (related + replacement heuristic passes), or ADD (new fact).
 *   3. Ambiguity fallback — NOOP rather than guessing.
 *
 * Pure: no I/O, no side effects. The caller owns store mutations.
 */
export function decideMerge(
  candidate: FactCandidate,
  candidateEmbedding: number[],
  neighbors: MemoryFact[],
): MergeDecision {
  // ── 1. Retraction branch ─────────────────────────────────────────────────
  if (isRetraction(candidate.text)) {
    if (neighbors.length === 0) {
      // B4: nothing to retract — do not ADD the retraction text
      return { action: "NOOP", targetFactId: null };
    }

    let bestSim = -Infinity;
    let bestNeighbor: MemoryFact | null = null;

    // Only consider same-kind neighbors: a biographical retraction must not
    // accidentally DELETE an unrelated preference fact that embeds nearby.
    for (const neighbor of neighbors) {
      if (neighbor.kind !== candidate.kind) continue;
      const sim = cosineSimilarity(candidateEmbedding, neighbor.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestNeighbor = neighbor;
      }
    }

    if (bestNeighbor !== null && bestSim >= RELATED_SIMILARITY) {
      return { action: "DELETE", targetFactId: bestNeighbor.id };
    }

    // B4: retracted thing no longer active — idempotent NOOP
    return { action: "NOOP", targetFactId: null };
  }

  // ── 2. Assertion branch ──────────────────────────────────────────────────
  // Pre-filter to same-kind neighbors only. A same-text/different-kind
  // candidate is a distinct fact — do not let a cross-kind neighbor trigger
  // a false NOOP or UPDATE and lose it.
  const sameKindNeighbors = neighbors.filter((n) => n.kind === candidate.kind);

  if (sameKindNeighbors.length === 0) {
    return { action: "ADD", targetFactId: null };
  }

  // Rank same-kind neighbors by similarity descending.
  const ranked = sameKindNeighbors
    .map((n) => ({
      neighbor: n,
      sim: cosineSimilarity(candidateEmbedding, n.embedding),
    }))
    .sort((a, b) => b.sim - a.sim);

  const { neighbor: best, sim: bestSim } = ranked[0];

  // Duplicate gate — precision over recall.
  if (bestSim >= DUP_SIMILARITY) {
    return { action: "NOOP", targetFactId: null };
  }

  // UPDATE band: check for ambiguity before committing to a target.
  if (bestSim >= RELATED_SIMILARITY) {
    // Ambiguity: two neighbors are too close to choose between.
    if (
      ranked.length >= 2 &&
      ranked[1].sim >= RELATED_SIMILARITY &&
      Math.abs(ranked[0].sim - ranked[1].sim) <= AMBIGUITY_EPSILON
    ) {
      // Precision-first fallback: do not guess which to UPDATE.
      return { action: "NOOP", targetFactId: null };
    }

    if (isReplacement(candidate, best)) {
      return { action: "UPDATE", targetFactId: best.id };
    }
  }

  // ── 3. Ambiguity fallback / new fact ─────────────────────────────────────
  // Sim is below RELATED_SIMILARITY or replacement heuristic returned false:
  // this is a genuinely new fact or an ambiguous update — ADD is safe.
  return { action: "ADD", targetFactId: null };
}
