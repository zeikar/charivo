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

// ── Stopword list for isReplacement ───────────────────────────────────────
// Short function words that don't carry subject/object meaning.
const STOPWORDS = new Set([
  "i",
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "about",
  "from",
  "as",
]);

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
 * Extracts content tokens: lowercase, split on non-word chars, drop
 * stopwords and tokens shorter than 3 characters.
 */
function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/**
 * Conservative deterministic heuristic for whether `candidate` replaces
 * `neighbor`. Returns true only when both share the same `kind` AND the
 * texts share at least one content token (the "subject") AND the candidate
 * has at least one content token not present in the neighbor (the "object"
 * has changed).
 *
 * Deliberately biased toward false (prefer false-NOOP / false-ADD over
 * false-UPDATE). No LLM. Stands in for a proper judge until one is wired in.
 *
 * MVP heuristic — document any changes to the token overlap rules here.
 */
export function isReplacement(
  candidate: FactCandidate,
  neighbor: MemoryFact,
): boolean {
  if (candidate.kind !== neighbor.kind) return false;

  const ct = contentTokens(candidate.text);
  const nt = contentTokens(neighbor.text);

  const hasSharedSubject = [...ct].some((t) => nt.has(t));
  const hasNewObject = [...ct].some((t) => !nt.has(t));

  return hasSharedSubject && hasNewObject;
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

    for (const neighbor of neighbors) {
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
  if (neighbors.length === 0) {
    return { action: "ADD", targetFactId: null };
  }

  // Rank neighbors by similarity descending.
  const ranked = neighbors
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
