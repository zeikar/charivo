/**
 * Tests for decideMerge — all ADD/UPDATE/DELETE/NOOP decision assertions.
 *
 * Fixtures use createFakeEmbedder() so cosine similarities are deterministic.
 * Text choices are calibrated to produce embeddings in the intended band;
 * see inline comments for actual cosine values.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { createFakeEmbedder } from "./embedding";
import { decideMerge, isRetraction, isReplacement } from "./decide-merge";
import type { FactCandidate } from "./promotion-types";
import type { MemoryFact } from "./types";
import { cosineSimilarity } from "./scoring";

// ── Shared embedder ────────────────────────────────────────────────────────

const embedder = createFakeEmbedder();

// ── MemoryFact factory ─────────────────────────────────────────────────────

function makeFact(
  overrides: Partial<MemoryFact> & { embedding: number[] },
): MemoryFact {
  return {
    id: "fact-1",
    scope: { userId: "u1", characterId: "c1" },
    text: "existing fact",
    kind: "preference",
    importance: 0.7,
    sourceSessionId: null,
    sourceTurnId: null,
    createdAt: 1000,
    validAt: 1000,
    invalidAt: null,
    supersededBy: null,
    ...overrides,
  };
}

// ── FactCandidate factory ──────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<FactCandidate> & { text: string },
): FactCandidate {
  return {
    kind: "preference",
    importance: 0.7,
    sourceTurnId: "turn-1",
    ...overrides,
  };
}

// ── isRetraction (unit) ────────────────────────────────────────────────────

describe("isRetraction", () => {
  it("detects 'no longer'", () => {
    expect(isRetraction("I no longer drink coffee")).toBe(true);
  });

  it("detects 'forget that'", () => {
    expect(isRetraction("Please forget that I said that")).toBe(true);
  });

  it("detects 'forget about'", () => {
    expect(isRetraction("Forget about what I mentioned")).toBe(true);
  });

  it("detects 'scratch that'", () => {
    expect(isRetraction("Scratch that, I changed my mind")).toBe(true);
  });

  it("detects 'never mind'", () => {
    expect(isRetraction("Never mind what I told you")).toBe(true);
  });

  it("detects 'used to'", () => {
    expect(isRetraction("I used to love sushi")).toBe(true);
  });

  it("detects 'stop remembering'", () => {
    expect(isRetraction("Please stop remembering that")).toBe(true);
  });

  it("detects 'don't remember'", () => {
    expect(isRetraction("I don't remember liking that")).toBe(true);
  });

  it("detects 'that's wrong' (contracted form)", () => {
    expect(isRetraction("No, that's wrong, I don't work there")).toBe(true);
  });

  it("detects 'that is wrong' (expanded form)", () => {
    expect(isRetraction("That is wrong")).toBe(true);
  });

  it("does NOT flag bare 'wrong' without the 'that('s/ is) wrong' marker", () => {
    // Precision guard for the added markers: "wrong" alone is a legitimate
    // opinion fact, not a retraction. Text contains neither marker substring.
    expect(isRetraction("I think eating meat is morally wrong")).toBe(false);
  });

  it("does NOT flag bare 'not' (M10: valid negative preference)", () => {
    expect(isRetraction("I'm not drinking alcohol anymore")).toBe(false);
  });

  it("does NOT flag bare 'don't' in a preference (M10)", () => {
    expect(isRetraction("I don't like spicy food")).toBe(false);
  });

  it("does NOT flag bare 'no' at the start", () => {
    expect(isRetraction("No, I prefer quiet restaurants")).toBe(false);
  });

  it("does NOT flag 'never' used as an adverb of frequency", () => {
    expect(isRetraction("I never skip breakfast")).toBe(false);
  });
});

// ── isReplacement (unit) ───────────────────────────────────────────────────

describe("isReplacement", () => {
  it("returns true when subject is declared and appears as a whole word in neighbor text", () => {
    // subject:"coffee" declared; "coffee" is a whole word in the neighbor text.
    const candidate = makeCandidate({
      text: "I take my coffee black",
      kind: "preference",
      subject: "coffee",
    });
    const neighbor = makeFact({
      text: "I take my coffee with milk",
      kind: "preference",
      embedding: [],
    });
    expect(isReplacement(candidate, neighbor)).toBe(true);
  });

  it("returns false when subject is absent (no declared metadata → no supersede)", () => {
    // Even though texts share 'coffee', absence of subject → conservative ADD.
    const candidate = makeCandidate({
      text: "I take my coffee black",
      kind: "preference",
      // subject intentionally omitted
    });
    const neighbor = makeFact({
      text: "I take my coffee with milk",
      kind: "preference",
      embedding: [],
    });
    expect(isReplacement(candidate, neighbor)).toBe(false);
  });

  it("returns false when subject is empty string", () => {
    const candidate = makeCandidate({
      text: "I take my coffee black",
      kind: "preference",
      subject: "",
    });
    const neighbor = makeFact({
      text: "I take my coffee with milk",
      kind: "preference",
      embedding: [],
    });
    expect(isReplacement(candidate, neighbor)).toBe(false);
  });

  it("returns false when subject is declared but does NOT appear in neighbor text", () => {
    // subject:"tea" not present in the neighbor about coffee → not a replacement.
    const candidate = makeCandidate({
      text: "I prefer tea",
      kind: "preference",
      subject: "tea",
    });
    const neighbor = makeFact({
      text: "I prefer quiet restaurants",
      kind: "preference",
      embedding: [],
    });
    expect(isReplacement(candidate, neighbor)).toBe(false);
  });

  it("subject match is whole-word (does not match partial word)", () => {
    // subject:"coffee" should not match "coffeemaker".
    const candidate = makeCandidate({
      text: "I prefer coffee",
      kind: "preference",
      subject: "coffee",
    });
    const neighbor = makeFact({
      text: "I own a coffeemaker",
      kind: "preference",
      embedding: [],
    });
    expect(isReplacement(candidate, neighbor)).toBe(false);
  });

  it("subject match is case-insensitive", () => {
    const candidate = makeCandidate({
      text: "I take my coffee black",
      kind: "preference",
      subject: "Coffee",
    });
    const neighbor = makeFact({
      text: "I take my coffee with milk",
      kind: "preference",
      embedding: [],
    });
    expect(isReplacement(candidate, neighbor)).toBe(true);
  });
});

// ── decideMerge — main decision cases ─────────────────────────────────────

describe("decideMerge", () => {
  // Embeddings are computed once per text fixture. The fake embedder is
  // bag-of-words bucket-hash over whitespace tokens, L2-normalized, 16 dims.

  let embNoNeighbor: number[];
  let embDupCandidate: number[];
  let embDupNeighbor: number[];
  let embUpdCandidate: number[];
  let embUpdNeighbor: number[];
  let embDelCandidate: number[];
  let embDelNeighbor: number[];
  let embB4Candidate: number[];
  let embM10a: number[];
  let embM10b: number[];
  let embAmbCandidate: number[];
  let embAmbN1: number[];
  let embAmbN2: number[];
  // [Finding 1] cross-kind retraction test
  let embF1RetractCandidate: number[];
  let embF1PreferenceNeighbor: number[];
  // [Finding 2] predicate-only sharing counterexample
  let embF2Candidate: number[];
  let embF2Neighbor: number[];

  beforeAll(async () => {
    // ADD: no neighbor
    embNoNeighbor = await embedder.embed("I enjoy hiking mountains");

    // NOOP (duplicate): cosine = 1.0 — exact same text
    embDupCandidate = await embedder.embed("I love pizza");
    embDupNeighbor = await embedder.embed("I love pizza");

    // UPDATE: cosine ≈ 0.8018 — in [0.6, 0.92) band
    // Candidate carries subject:"coffee"; neighbor text contains "coffee" as a
    // whole word → isReplacement returns true → UPDATE.
    embUpdCandidate = await embedder.embed("I take my coffee black");
    embUpdNeighbor = await embedder.embed("I take my coffee with milk");

    // DELETE: cosine ≈ 0.6761 — retraction phrase + same-kind match >= 0.6
    embDelCandidate = await embedder.embed("I no longer drink coffee");
    embDelNeighbor = await embedder.embed("I drink coffee every morning");

    // [B4] NOOP retraction with no match: use empty neighbors array
    embB4Candidate = await embedder.embed("I no longer play chess");

    // [M10] Negative preferences — NOT retraction markers
    embM10a = await embedder.embed("I don't like spicy food");
    embM10b = await embedder.embed("I'm not drinking alcohol anymore");

    // Ambiguous: two neighbors at exactly cosine 0.75 each — tied in UPDATE band
    embAmbCandidate = await embedder.embed("I enjoy swimming laps");
    embAmbN1 = await embedder.embed("I enjoy running laps");
    embAmbN2 = await embedder.embed("I enjoy cycling laps");

    // [Finding 1] cross-kind: biographical retraction, cosine ≈ 0.7334 to a
    // preference neighbor — must NOT DELETE because kinds differ.
    embF1RetractCandidate = await embedder.embed(
      "I no longer work as a teacher",
    );
    embF1PreferenceNeighbor = await embedder.embed("I work at a school");

    // [Finding 2] predicate-only sharing: "prefer" shared, no content subject —
    // must be ADD, not UPDATE.
    embF2Candidate = await embedder.embed("I prefer tea");
    embF2Neighbor = await embedder.embed("I prefer quiet restaurants");
  });

  // ── ADD: no neighbor ────────────────────────────────────────────────────
  it("assertion with no neighbors → ADD", () => {
    const candidate = makeCandidate({
      text: "I enjoy hiking mountains",
      kind: "preference",
    });
    const result = decideMerge(candidate, embNoNeighbor, []);
    expect(result).toEqual({ action: "ADD", targetFactId: null });
  });

  // ── NOOP: near-identical duplicate ──────────────────────────────────────
  it("assertion with near-identical neighbor (cosine ≥ DUP=0.92) → NOOP", async () => {
    const sim = cosineSimilarity(embDupCandidate, embDupNeighbor);
    // Sanity check the fixture is in the right zone
    expect(sim).toBeGreaterThanOrEqual(0.92);

    const candidate = makeCandidate({
      text: "I love pizza",
      kind: "preference",
    });
    const neighbor = makeFact({
      id: "fact-dup",
      text: "I love pizza",
      kind: "preference",
      embedding: embDupNeighbor,
    });

    const result = decideMerge(candidate, embDupCandidate, [neighbor]);
    expect(result).toEqual({ action: "NOOP", targetFactId: null });
  });

  // ── UPDATE: related neighbor + replacement ───────────────────────────────
  it("assertion with related neighbor in UPDATE band → UPDATE with targetFactId", async () => {
    const sim = cosineSimilarity(embUpdCandidate, embUpdNeighbor);
    // Verify band: cosine ≈ 0.8018, genuinely in [0.6, 0.92)
    expect(sim).toBeGreaterThanOrEqual(0.6);
    expect(sim).toBeLessThan(0.92);

    // subject:"coffee" declared; "coffee" appears in the neighbor → isReplacement true.
    const candidate = makeCandidate({
      text: "I take my coffee black",
      kind: "preference",
      subject: "coffee",
    });
    const neighbor = makeFact({
      id: "fact-upd-01",
      text: "I take my coffee with milk",
      kind: "preference",
      embedding: embUpdNeighbor,
    });

    const result = decideMerge(candidate, embUpdCandidate, [neighbor]);
    expect(result.action).toBe("UPDATE");
    expect(result.targetFactId).toBe("fact-upd-01");
  });

  // ── DELETE: retraction with matching active neighbor ────────────────────
  it("retraction with matching active neighbor (cosine ≥ RELATED=0.6) → DELETE", async () => {
    const sim = cosineSimilarity(embDelCandidate, embDelNeighbor);
    // cosine ≈ 0.6761 — above RELATED threshold
    expect(sim).toBeGreaterThanOrEqual(0.6);

    const candidate = makeCandidate({
      text: "I no longer drink coffee",
      kind: "preference",
    });
    const neighbor = makeFact({
      id: "fact-del-01",
      text: "I drink coffee every morning",
      kind: "preference",
      embedding: embDelNeighbor,
    });

    const result = decideMerge(candidate, embDelCandidate, [neighbor]);
    expect(result.action).toBe("DELETE");
    expect(result.targetFactId).toBe("fact-del-01");
  });

  // ── [B4] NOOP: retraction with no matching active neighbor ───────────────
  it("[B4] retraction with no neighbors → NOOP (NOT ADD)", () => {
    const candidate = makeCandidate({
      text: "I no longer play chess",
      kind: "preference",
    });
    const result = decideMerge(candidate, embB4Candidate, []);
    expect(result).toEqual({ action: "NOOP", targetFactId: null });
  });

  it("[B4] retraction where existing neighbor sim < RELATED → NOOP (idempotent)", async () => {
    // A neighbor about something unrelated — cosine will be below 0.6
    const unrelatedEmbedding = await embedder.embed(
      "I love cooking pasta every weekend",
    );
    const sim = cosineSimilarity(embB4Candidate, unrelatedEmbedding);
    expect(sim).toBeLessThan(0.6);

    const candidate = makeCandidate({
      text: "I no longer play chess",
      kind: "preference",
    });
    const neighbor = makeFact({
      id: "fact-unrelated",
      text: "I love cooking pasta every weekend",
      kind: "preference",
      embedding: unrelatedEmbedding,
    });

    const result = decideMerge(candidate, embB4Candidate, [neighbor]);
    expect(result).toEqual({ action: "NOOP", targetFactId: null });
  });

  // ── [M10] Negative preferences → ADD (not retraction) ───────────────────
  it("[M10] 'I don't like spicy food' (negative preference) with no neighbors → ADD", () => {
    const candidate = makeCandidate({
      text: "I don't like spicy food",
      kind: "preference",
    });
    // isRetraction must be false for this text
    expect(isRetraction(candidate.text)).toBe(false);
    const result = decideMerge(candidate, embM10a, []);
    expect(result).toEqual({ action: "ADD", targetFactId: null });
  });

  it("[M10] 'I'm not drinking alcohol anymore' (negative preference) with no neighbors → ADD", () => {
    const candidate = makeCandidate({
      text: "I'm not drinking alcohol anymore",
      kind: "preference",
    });
    expect(isRetraction(candidate.text)).toBe(false);
    const result = decideMerge(candidate, embM10b, []);
    expect(result).toEqual({ action: "ADD", targetFactId: null });
  });

  // ── Ambiguous: two equally similar neighbors in UPDATE band → NOOP ───────
  it("two neighbors tied at cosine 0.75 in UPDATE band → NOOP (ambiguity fallback)", async () => {
    const sim1 = cosineSimilarity(embAmbCandidate, embAmbN1);
    const sim2 = cosineSimilarity(embAmbCandidate, embAmbN2);
    // Both must be in [0.6, 0.92) and within epsilon of each other
    expect(sim1).toBeGreaterThanOrEqual(0.6);
    expect(sim1).toBeLessThan(0.92);
    expect(sim2).toBeGreaterThanOrEqual(0.6);
    expect(sim2).toBeLessThan(0.92);
    expect(Math.abs(sim1 - sim2)).toBeLessThanOrEqual(0.001);

    const candidate = makeCandidate({
      text: "I enjoy swimming laps",
      kind: "preference",
    });
    const n1 = makeFact({
      id: "fact-amb-01",
      text: "I enjoy running laps",
      kind: "preference",
      embedding: embAmbN1,
    });
    const n2 = makeFact({
      id: "fact-amb-02",
      text: "I enjoy cycling laps",
      kind: "preference",
      embedding: embAmbN2,
    });

    const result = decideMerge(candidate, embAmbCandidate, [n1, n2]);
    expect(result).toEqual({ action: "NOOP", targetFactId: null });
  });

  // ── [Finding 1] Cross-kind retraction → NOOP ────────────────────────────
  it("[Finding 1] biographical retraction does NOT delete a different-kind (preference) neighbor even when cosine is high", async () => {
    // cosine ≈ 0.7334 — above RELATED_SIMILARITY, but kinds differ → NOOP
    const sim = cosineSimilarity(
      embF1RetractCandidate,
      embF1PreferenceNeighbor,
    );
    expect(sim).toBeGreaterThanOrEqual(0.6);

    const candidate = makeCandidate({
      text: "I no longer work as a teacher",
      kind: "biographical",
    });
    const neighbor = makeFact({
      id: "fact-pref-school",
      text: "I work at a school",
      kind: "preference", // different kind — must not be deleted
      embedding: embF1PreferenceNeighbor,
    });

    const result = decideMerge(candidate, embF1RetractCandidate, [neighbor]);
    expect(result).toEqual({ action: "NOOP", targetFactId: null });
  });

  // ── [Finding 2] No declared subject → ADD (not UPDATE) ───────────────────
  it("[Finding 2] candidate in RELATED band with no declared subject → ADD (conservative)", async () => {
    // No subject metadata → isReplacement returns false regardless of text
    // similarity; two preferences that share only a predicate stay separate.
    const sim = cosineSimilarity(embF2Candidate, embF2Neighbor);
    expect(sim).toBeGreaterThanOrEqual(0.6);
    expect(sim).toBeLessThan(0.92);

    const candidate = makeCandidate({
      text: "I prefer tea",
      kind: "preference",
      // subject intentionally absent — no metadata → no supersede
    });
    const neighbor = makeFact({
      id: "fact-pref-restaurants",
      text: "I prefer quiet restaurants",
      kind: "preference",
      embedding: embF2Neighbor,
    });

    const result = decideMerge(candidate, embF2Candidate, [neighbor]);
    expect(result).toEqual({ action: "ADD", targetFactId: null });
  });

  // ── [Finding 3] Same-text different-kind → ADD (kind filter) ─────────────
  it("[Finding 3] candidate same text as existing fact but different kind → ADD", async () => {
    // The dup gate must not fire across kinds. After kind-filtering, no
    // same-kind neighbor exists → ADD (the new fact is a distinct kind).
    const embedding = await embedder.embed("I love pizza");
    const candidate = makeCandidate({
      text: "I love pizza",
      kind: "biographical", // different kind from the neighbor
    });
    const neighbor = makeFact({
      id: "fact-pizza-pref",
      text: "I love pizza",
      kind: "preference", // same text, different kind
      embedding,
    });

    // cosine = 1.0 (identical text) — would be NOOP without kind filter
    const sim = cosineSimilarity(embedding, neighbor.embedding);
    expect(sim).toBeGreaterThanOrEqual(0.92);

    const result = decideMerge(candidate, embedding, [neighbor]);
    expect(result).toEqual({ action: "ADD", targetFactId: null });
  });

  // ── [Finding 4] Generic-verb shared token with declared subject not in neighbor → ADD
  it("[Finding 4] candidate with subject not mentioned in neighbor text → ADD (no false UPDATE)", async () => {
    // subject:"tea" declared, but neighbor "I take medication daily" does not
    // contain "tea" → isReplacement false → ADD (unrelated facts stay separate).
    const embCandidate = await embedder.embed("I drink tea");
    const embNeighbor = await embedder.embed("I take medication daily");
    const candidate = makeCandidate({
      text: "I drink tea",
      kind: "preference",
      subject: "tea",
    });
    const neighbor = makeFact({
      id: "fact-medication",
      text: "I take medication daily",
      kind: "preference",
      embedding: embNeighbor,
    });

    const result = decideMerge(candidate, embCandidate, [neighbor]);
    expect(result).toEqual({ action: "ADD", targetFactId: null });
  });
});
