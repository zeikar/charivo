import { describe, expect, it } from "vitest";
import { createFakeEmbedder } from "./embedding";

function cosineSimilarity(a: number[], b: number[]): number {
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

describe("FakeEmbedder", () => {
  it("returns the identical vector for the same input (determinism)", async () => {
    const embedder = createFakeEmbedder();
    const a = await embedder.embed("hello world");
    const b = await embedder.embed("hello world");
    expect(a).toEqual(b);
  });

  it("returns a vector whose length equals the fixed dimensions", async () => {
    const embedder = createFakeEmbedder();
    const vec = await embedder.embed("test string");
    expect(vec).toHaveLength(embedder.dimensions);
  });

  it("two strings sharing tokens have higher cosine similarity than two disjoint strings", async () => {
    const embedder = createFakeEmbedder();
    const base = await embedder.embed("cat sat mat");
    const similar = await embedder.embed("cat sat on a mat");
    const disjoint = await embedder.embed("quantum physics neutron");

    const simSimilar = cosineSimilarity(base, similar);
    const simDisjoint = cosineSimilarity(base, disjoint);
    expect(simSimilar).toBeGreaterThan(simDisjoint);
  });

  it("empty string returns a finite vector with no NaN entries", async () => {
    const embedder = createFakeEmbedder();
    const vec = await embedder.embed("");
    expect(vec).toHaveLength(embedder.dimensions);
    for (const v of vec) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
