import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  estimateTokens,
  recencyDecay,
  scoreFact,
} from "./scoring";
import type { MemoryFact } from "./types";

// Minimal MemoryFact factory — only the fields scoring.ts touches.
function makeFact(overrides: Partial<MemoryFact>): MemoryFact {
  return {
    id: "test",
    scope: { userId: "u1", characterId: "c1" },
    text: "test fact",
    kind: "other",
    embedding: [1, 0, 0],
    importance: 0.5,
    sourceSessionId: null,
    sourceTurnId: null,
    createdAt: 1000,
    validAt: 1000,
    invalidAt: null,
    supersededBy: null,
    ...overrides,
  };
}

// ─── cosineSimilarity ──────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("identical (parallel) vectors → ≈ 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("orthogonal vectors → ≈ 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
  });

  it("mismatched length → 0 (no NaN)", () => {
    const result = cosineSimilarity([1, 2], [1, 2, 3]);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("zero vector → 0 (no NaN)", () => {
    const result = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("both zero vectors → 0 (no NaN)", () => {
    const result = cosineSimilarity([0, 0], [0, 0]);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });
});

// ─── recencyDecay ──────────────────────────────────────────────────────────

describe("recencyDecay", () => {
  it("returns 1 at age 0 (createdAt === now)", () => {
    expect(recencyDecay(5000, 5000)).toBe(1);
  });

  it("monotonic decreasing as age increases", () => {
    const now = 1_000_000;
    const d0 = recencyDecay(now, now);
    const d1 = recencyDecay(now - 1_000, now);
    const d2 = recencyDecay(now - 100_000, now);
    const d3 = recencyDecay(now - 1_000_000, now);
    expect(d0).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(d2);
    expect(d2).toBeGreaterThan(d3);
  });

  it("future createdAt (createdAt > now) returns a finite value ≤ 1", () => {
    const result = recencyDecay(9999, 1000);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThan(0);
  });
});

// ─── estimateTokens ────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("monotonic non-decreasing as string length grows", () => {
    const results = ["a", "ab", "abcd", "abcdefgh"].map(estimateTokens);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBeGreaterThanOrEqual(results[i - 1]);
    }
  });

  it("returns a positive integer for a non-empty string", () => {
    const t = estimateTokens("hello world");
    expect(t).toBeGreaterThan(0);
    expect(Number.isInteger(t)).toBe(true);
  });
});

// ─── scoreFact ─────────────────────────────────────────────────────────────

describe("scoreFact", () => {
  const NOW = 1_000_000;

  it("higher importance ranks higher when other inputs are equal", () => {
    const base = { createdAt: NOW, embedding: [1, 0, 0] };
    const lo = makeFact({ ...base, importance: 0.1 });
    const hi = makeFact({ ...base, importance: 0.9 });
    expect(scoreFact(hi, { now: NOW })).toBeGreaterThan(
      scoreFact(lo, { now: NOW }),
    );
  });

  it("more recent fact ranks higher when other inputs are equal", () => {
    const base = { embedding: [1, 0, 0], importance: 0.5 };
    const old = makeFact({ ...base, createdAt: NOW - 1_000_000 });
    const fresh = makeFact({ ...base, createdAt: NOW });
    expect(scoreFact(fresh, { now: NOW })).toBeGreaterThan(
      scoreFact(old, { now: NOW }),
    );
  });

  it("with queryEmbedding, closer embedding scores higher (other terms equal)", () => {
    const createdAt = NOW - 1000;
    const importance = 0.5;
    const query = [1, 0, 0];

    // parallel to query → cosine ≈ 1
    const close = makeFact({ createdAt, importance, embedding: [1, 0, 0] });
    // orthogonal to query → cosine ≈ 0
    const far = makeFact({ createdAt, importance, embedding: [0, 1, 0] });

    expect(
      scoreFact(close, { now: NOW, queryEmbedding: query }),
    ).toBeGreaterThan(scoreFact(far, { now: NOW, queryEmbedding: query }));
  });

  it("relevance contributes 0 when queryEmbedding is absent", () => {
    const fact = makeFact({
      createdAt: NOW,
      importance: 0.5,
      embedding: [1, 0, 0],
    });
    const withQuery = scoreFact(fact, {
      now: NOW,
      queryEmbedding: [1, 0, 0],
      // use equal weights so relevance clearly adds to the score
      weights: { recency: 0.4, importance: 0.4, relevance: 0.2 },
    });
    const withoutQuery = scoreFact(fact, {
      now: NOW,
      weights: { recency: 0.4, importance: 0.4, relevance: 0.2 },
    });
    // with a perfect relevance match the score should be higher
    expect(withQuery).toBeGreaterThan(withoutQuery);
  });

  it("uses default weights when opts.weights is omitted", () => {
    const fact = makeFact({ createdAt: NOW, importance: 0.5 });
    const score = scoreFact(fact, { now: NOW });
    // recency=1, importance=0.5, relevance=0 → 0.4*1 + 0.4*0.5 + 0.2*0 = 0.6
    expect(score).toBeCloseTo(0.6, 10);
  });
});
