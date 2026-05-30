import type { MemoryFact } from "./types";

// Half-life for recency decay: 7 days in milliseconds.
// Not a parameter (YAGNI) — this is the module-level tuning constant.
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_WEIGHTS = { recency: 0.4, importance: 0.4, relevance: 0.2 };

/**
 * Cosine similarity between two vectors.
 * Returns 0 for mismatched lengths or zero vectors — never NaN.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Exponential recency decay in (0, 1].
 * Returns 1 when createdAt === now. Decreases as age grows.
 * Future createdAt (createdAt > now) is treated as age 0, so it returns 1.
 */
export function recencyDecay(createdAt: number, now: number): number {
  const ageMs = Math.max(0, now - createdAt);
  return Math.pow(2, -ageMs / HALF_LIFE_MS);
}

/**
 * Cheap deterministic token count estimate (~4 chars per token).
 * Documented as an approximation only. Returns 0 for empty string.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Score a single fact against the query context.
 * Pure — clock is injected via `opts.now`; never reads `Date` directly.
 *
 * score = wR·recency + wI·importance + wRel·relevance
 * relevance contributes 0 when opts.queryEmbedding is absent.
 */
export function scoreFact(
  fact: MemoryFact,
  opts: {
    now: number;
    queryEmbedding?: number[];
    weights?: { recency: number; importance: number; relevance: number };
  },
): number {
  const w = opts.weights ?? DEFAULT_WEIGHTS;

  const recency = recencyDecay(fact.createdAt, opts.now);
  const importance = fact.importance;
  const relevance =
    opts.queryEmbedding !== undefined
      ? cosineSimilarity(opts.queryEmbedding, fact.embedding)
      : 0;

  return (
    w.recency * recency + w.importance * importance + w.relevance * relevance
  );
}
