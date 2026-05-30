/**
 * Deterministic eval scenarios (A–H) for the memory harness. Each scenario
 * declares its EXPECTED fact-ids by calling `expectedFactId` (computed, never a
 * literal), so a fact-id-formula change fails loudly. Mirrors the
 * `memory/__fixtures__/transcripts.ts` discipline (NOW anchor, shared SCOPE,
 * scripts keyed by turn-id, documented cosines for any NEW authored text).
 *
 * Test/eval-only by convention (under `__fixtures__/`).
 *
 * Authored-cosine note (Scenario B, 16-dim bag-of-words `createFakeEmbedder`,
 * verified) against the query "i love playing guitar music":
 *   "I love playing guitar"     ≈ 0.8944  (rank 1)
 *   "I love music"              ≈ 0.7746  (rank 2)
 *   "I work as a teacher"       ≈ 0.4472  (distractor)
 *   "The weather is fine today" ≈ 0.2981  (distractor)
 * → a strict, tie-free ordering so the relevance-only retrieval sort is
 *   deterministic and the top-2 slice equals the ordered expectedTopK.
 */

import type { MemoryScope } from "../../memory/types";
import type { FactCandidate, Transcript } from "../../memory/promotion-types";
import {
  NOW,
  SCOPE,
  firstSessionTranscript,
  firstSessionScript,
  correctionTranscript,
  correctionScript,
  forgetThatTranscript,
  forgetThatScript,
} from "../../memory/__fixtures__/transcripts";
import { expectedFactId } from "../fact-id";

export { NOW, SCOPE } from "../../memory/__fixtures__/transcripts";

// ---------------------------------------------------------------------------
// Scenario A — extraction fact-ids (reuse first-session). u3 (importance 0.2)
// and a1 (assistant-sourced) are expected-EXCLUDED: they are simply absent from
// expectedFactIds, so positive-set precision/recall already catches a leak.
// ---------------------------------------------------------------------------

const A_MILK = firstSessionScript.u1[0]; // "I take my coffee with milk", preference, 0.8
const A_TEACHER = firstSessionScript.u2[0]; // "I work as a teacher", biographical, 0.7

export const extractionScenario = {
  transcript: firstSessionTranscript,
  script: firstSessionScript,
  expectedFactIds: new Set([
    expectedFactId(SCOPE, A_MILK),
    expectedFactId(SCOPE, A_TEACHER),
  ]),
};

// ---------------------------------------------------------------------------
// Scenario B — retrieval top-K (ordered). Seeded via direct upsertFact in the
// suite (no merge interference); ranked by relevance-only cosine.
// ---------------------------------------------------------------------------

export const B_QUERY = "i love playing guitar music";

const B_F1: FactCandidate = {
  text: "I love playing guitar",
  kind: "preference",
  importance: 0.8,
  sourceTurnId: "b1",
};
const B_F2: FactCandidate = {
  text: "I love music",
  kind: "preference",
  importance: 0.8,
  sourceTurnId: "b2",
};
const B_D1: FactCandidate = {
  text: "I work as a teacher",
  kind: "biographical",
  importance: 0.7,
  sourceTurnId: "b3",
};
const B_D2: FactCandidate = {
  text: "The weather is fine today",
  kind: "other",
  importance: 0.7,
  sourceTurnId: "b4",
};

export const retrievalScenario = {
  seedCandidates: [B_F1, B_F2, B_D1, B_D2] as FactCandidate[],
  queryText: B_QUERY,
  /** Ordered, most-relevant first. */
  expectedTopK: [expectedFactId(SCOPE, B_F1), expectedFactId(SCOPE, B_F2)],
  relevantIds: new Set([
    expectedFactId(SCOPE, B_F1),
    expectedFactId(SCOPE, B_F2),
  ]),
};

// ---------------------------------------------------------------------------
// Scenario C — non-memories excluded (roleplay / jokes + assistant-sourced).
// c1/c2: importance < 0.4 → policyFilter drops. c3: assistant → extractFacts drops.
// ---------------------------------------------------------------------------

export const nonMemoryTranscript: Transcript = {
  sessionId: "eval-nonmem",
  scope: SCOPE,
  startedAt: NOW - 10_000,
  endedAt: NOW,
  turns: [
    {
      id: "c1",
      role: "user",
      text: "Pretend you are a dragon and roar",
      at: NOW - 9000,
    },
    {
      id: "c2",
      role: "user",
      text: "Knock knock who is there",
      at: NOW - 8000,
    },
    { id: "c3", role: "assistant", text: "Haha a banana", at: NOW - 7000 },
  ],
};

const C_C1: FactCandidate = {
  text: "Pretend you are a dragon and roar",
  kind: "other",
  importance: 0.1,
  sourceTurnId: "c1",
};
const C_C2: FactCandidate = {
  text: "Knock knock who is there",
  kind: "other",
  importance: 0.1,
  sourceTurnId: "c2",
};
const C_A1: FactCandidate = {
  text: "The assistant told a banana joke",
  kind: "other",
  importance: 0.9,
  sourceTurnId: "c3",
};

export const nonMemoryScript: Record<string, FactCandidate[]> = {
  c1: [C_C1],
  c2: [C_C2],
  c3: [C_A1],
};

export const nonMemoryScenario = {
  transcript: nonMemoryTranscript,
  script: nonMemoryScript,
  /** Ids these junk candidates WOULD get if (wrongly) admitted; none must leak. */
  wouldBeFactIds: new Set([
    expectedFactId(SCOPE, C_C1),
    expectedFactId(SCOPE, C_C2),
    expectedFactId(SCOPE, C_A1),
  ]),
};

// ---------------------------------------------------------------------------
// Scenario D — supersede-then-excluded (deletion compliance). Seed the teacher
// fact (A.u2), then the "forget that" retraction; the teacher fact must be gone.
// ---------------------------------------------------------------------------

export const deletionScenario = {
  seedTranscript: firstSessionTranscript,
  seedScript: firstSessionScript,
  retractionTranscript: forgetThatTranscript,
  retractionScript: forgetThatScript,
  expectedRetiredFactId: expectedFactId(SCOPE, A_TEACHER),
};

// ---------------------------------------------------------------------------
// Scenario E — scope isolation. A distinct user+character; its fact must NOT
// surface when retrieving under the primary SCOPE.
// ---------------------------------------------------------------------------

export const SCOPE_B: MemoryScope = { userId: "userB", characterId: "charB" };

export const foreignTranscript: Transcript = {
  sessionId: "eval-scopeB",
  scope: SCOPE_B,
  startedAt: NOW - 10_000,
  endedAt: NOW,
  turns: [
    {
      id: "e1",
      role: "user",
      text: "I am allergic to peanuts",
      at: NOW - 9000,
    },
  ],
};

const E_E1: FactCandidate = {
  text: "I am allergic to peanuts",
  kind: "biographical",
  importance: 0.8,
  sourceTurnId: "e1",
};

export const foreignScript: Record<string, FactCandidate[]> = { e1: [E_E1] };

export const scopeIsolationScenario = {
  primaryScope: SCOPE,
  primaryTranscript: firstSessionTranscript,
  primaryScript: firstSessionScript,
  foreignScope: SCOPE_B,
  foreignTranscript,
  foreignScript,
  foreignExpectedId: expectedFactId(SCOPE_B, E_E1),
};

// ---------------------------------------------------------------------------
// Scenario F — STT misrecognition. The candidate text IS the as-heard form (no
// repair step exists). We measure ONLY that a noisy-but-admissible turn is not
// dropped; the id is hashed from the as-heard text.
// ---------------------------------------------------------------------------

export const sttTranscript: Transcript = {
  sessionId: "eval-stt",
  scope: SCOPE,
  startedAt: NOW - 10_000,
  endedAt: NOW,
  turns: [
    {
      id: "f1",
      role: "user",
      text: "I have a cat named Toe-foo",
      at: NOW - 9000,
    },
  ],
};

const F_F1: FactCandidate = {
  text: "I have a cat named Toe-foo",
  kind: "biographical",
  importance: 0.7,
  sourceTurnId: "f1",
};

export const sttScript: Record<string, FactCandidate[]> = { f1: [F_F1] };

export const sttScenario = {
  transcript: sttTranscript,
  script: sttScript,
  expectedId: expectedFactId(SCOPE, F_F1),
};

// ---------------------------------------------------------------------------
// Scenario G — temporal correction (coffee UPDATE: milk → black, subject coffee).
// After correction the black fact is active and the milk fact is retired.
// ---------------------------------------------------------------------------

const G_BLACK = correctionScript.u4[0]; // "I take my coffee black", preference, subject coffee

export const temporalScenario = {
  seedTranscript: firstSessionTranscript,
  seedScript: firstSessionScript,
  correctionTranscript,
  correctionScript,
  expectedRetiredId: expectedFactId(SCOPE, A_MILK),
  expectedActiveId: expectedFactId(SCOPE, G_BLACK),
};

// ---------------------------------------------------------------------------
// Scenario H — injected-token REPORT (no wrapper-blind budget assertion). Reuse
// Scenario B's seed as a small fact list to render.
// ---------------------------------------------------------------------------

export const injectedTokenScenario = {
  seedCandidates: [B_F1, B_F2, B_D1, B_D2] as FactCandidate[],
};

// ---------------------------------------------------------------------------
// BROKEN_EXTRACTION_SCRIPT (TEST-ONLY, flag-gated). Scenario A's two correct
// candidates PLUS one hallucinated candidate that cites a REAL user turn (u1, so
// it survives extractFacts) with importance >= 0.4 (survives policyFilter) but a
// text NOT in extractionScenario.expectedFactIds → a false positive → extraction
// precision < 1 → the precision assertion fails AND the
// EXTRACTION_PRECISION_BELOW_THRESHOLD marker prints. The break is the seeded
// regression the sensitivity check catches for the right reason.
// ---------------------------------------------------------------------------

const HALLUCINATED: FactCandidate = {
  text: "the user is a secret agent",
  kind: "other",
  importance: 0.9,
  sourceTurnId: "u1",
};

export const BROKEN_EXTRACTION_SCRIPT: Record<string, FactCandidate[]> = {
  ...firstSessionScript,
  hallucinated: [HALLUCINATED],
};
