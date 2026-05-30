/**
 * Hand-authored transcript fixtures + their scripted-extractor scripts for the
 * promotion pipeline tests.
 *
 * Test-only by convention (lives under `__fixtures__/` so it typechecks, but
 * only `*.test.ts` files import it).
 *
 * The texts are deliberately authored so the fake bag-of-words embedder
 * (`createFakeEmbedder`) yields the intended merge decisions. The relevant
 * cosines (verified empirically) are:
 *   - "I take my coffee with milk" vs "I take my coffee black"  ≈ 0.8018 (UPDATE band)
 *   - "I work as a teacher" vs "I no longer work as a teacher"  ≈ 0.9701 (DELETE band)
 *   - "Forget that I work as a teacher" vs "I work as a teacher"  ≈ 0.9045 (DELETE band)
 *   - "That's wrong, I don't work as a teacher" vs "I work as a teacher"  ≈ 0.8660 (DELETE band)
 * The correction candidate carries `subject:"coffee"` so the explicit-subject
 * isReplacement check matches ("coffee" appears in the seeded neighbor's text).
 * The two retraction fixtures below carry NO `subject` — they are pure DELETE
 * retractions (the "forget that" / "that's wrong" markers drive the decision).
 */

import type { MemoryScope } from "../types";
import type { FactCandidate, Transcript } from "../promotion-types";

/** Fixed clock anchor — mirrors the store-test constant so the store clock can match. */
export const NOW = 1_700_000_000_000;

/** Shared scope for every fixture below. */
export const SCOPE: MemoryScope = { userId: "userA", characterId: "charA" };

// ---------------------------------------------------------------------------
// First session: establishes a preference + a biographical fact, plus a
// low-importance candidate (policy-rejected) and an assistant-sourced
// candidate (evidence-filtered by extractFacts).
// ---------------------------------------------------------------------------

export const firstSessionTranscript: Transcript = {
  sessionId: "s1",
  scope: SCOPE,
  startedAt: NOW - 60_000,
  endedAt: NOW,
  turns: [
    {
      id: "u1",
      role: "user",
      text: "I take my coffee with milk",
      at: NOW - 50_000,
    },
    { id: "u2", role: "user", text: "I work as a teacher", at: NOW - 40_000 },
    {
      id: "u3",
      role: "user",
      text: "The weather is fine today",
      at: NOW - 30_000,
    },
    {
      id: "a1",
      role: "assistant",
      text: "Got it, I will remember that.",
      at: NOW - 20_000,
    },
  ],
};

export const firstSessionScript: Record<string, FactCandidate[]> = {
  u1: [
    {
      text: "I take my coffee with milk",
      kind: "preference",
      importance: 0.8,
      sourceTurnId: "u1",
    },
  ],
  u2: [
    {
      text: "I work as a teacher",
      kind: "biographical",
      importance: 0.7,
      sourceTurnId: "u2",
    },
  ],
  // Below IMPORTANCE_ADMIT_THRESHOLD (0.4): admitted by extractFacts (valid
  // user source + in-range importance) but rejected by policyFilter.
  u3: [
    {
      text: "The weather is fine today",
      kind: "other",
      importance: 0.2,
      sourceTurnId: "u3",
    },
  ],
  // Assistant-sourced: extractFacts drops it (not a user turn id) → no fact.
  a1: [
    {
      text: "The assistant promised to remember things",
      kind: "other",
      importance: 0.9,
      sourceTurnId: "a1",
    },
  ],
};

// ---------------------------------------------------------------------------
// Correction session: a later session, same scope, that changes the earlier
// preference (UPDATE/supersede of "I prefer coffee") and retracts the
// biographical fact (DELETE/invalidate of "I work as a teacher").
// ---------------------------------------------------------------------------

export const correctionTranscript: Transcript = {
  sessionId: "s2",
  scope: SCOPE,
  startedAt: NOW + 60_000,
  endedAt: NOW + 120_000,
  turns: [
    {
      id: "u4",
      role: "user",
      text: "I take my coffee black",
      at: NOW + 70_000,
    },
    {
      id: "u5",
      role: "user",
      text: "I no longer work as a teacher",
      at: NOW + 80_000,
    },
  ],
};

export const correctionScript: Record<string, FactCandidate[]> = {
  // Same kind as the milk fact; subject:"coffee" anchors the replacement check
  // ("coffee" appears in "I take my coffee with milk") → UPDATE (supersede).
  u4: [
    {
      text: "I take my coffee black",
      kind: "preference",
      importance: 0.8,
      sourceTurnId: "u4",
      subject: "coffee",
    },
  ],
  // "no longer" retraction marker + high overlap with the teacher fact → DELETE.
  u5: [
    {
      text: "I no longer work as a teacher",
      kind: "biographical",
      importance: 0.7,
      sourceTurnId: "u5",
    },
  ],
};

// ---------------------------------------------------------------------------
// Retraction sessions: a later session, same scope, that retracts the seeded
// biographical "I work as a teacher" fact via an explicit "forget that" /
// "that's wrong" marker. No `subject` → pure DELETE (invalidate), not an
// UPDATE. Each text is authored to embed the teacher fact's tokens so the fake
// embedder's cosine clears RELATED_SIMILARITY (0.6) and DELETE targets it.
// ---------------------------------------------------------------------------

export const forgetThatTranscript: Transcript = {
  sessionId: "s3",
  scope: SCOPE,
  startedAt: NOW + 60_000,
  endedAt: NOW + 120_000,
  turns: [
    {
      id: "u6",
      role: "user",
      text: "Forget that I work as a teacher",
      at: NOW + 70_000,
    },
  ],
};

export const forgetThatScript: Record<string, FactCandidate[]> = {
  // "forget that" marker + the teacher fact embedded verbatim → DELETE the
  // seeded biographical fact. No subject: a pure retraction, not a replacement.
  u6: [
    {
      text: "Forget that I work as a teacher",
      kind: "biographical",
      importance: 0.7,
      sourceTurnId: "u6",
    },
  ],
};

export const thatsWrongTranscript: Transcript = {
  sessionId: "s4",
  scope: SCOPE,
  startedAt: NOW + 60_000,
  endedAt: NOW + 120_000,
  turns: [
    {
      id: "u7",
      role: "user",
      text: "That's wrong, I don't work as a teacher",
      at: NOW + 70_000,
    },
  ],
};

export const thatsWrongScript: Record<string, FactCandidate[]> = {
  // "that's wrong" marker (added in Task 1) + high overlap with the teacher
  // fact (work/as/a/teacher) → DELETE. No subject: pure retraction.
  u7: [
    {
      text: "That's wrong, I don't work as a teacher",
      kind: "biographical",
      importance: 0.7,
      sourceTurnId: "u7",
    },
  ],
};
