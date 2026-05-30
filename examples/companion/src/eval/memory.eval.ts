/**
 * Memory eval suite — drives the REAL mechanism (extractFacts / policyFilter /
 * promoteSession / SqliteMemoryStore.retrieve / render) over the deterministic
 * fixtures, computes the precision-first metrics, and asserts the thresholds.
 *
 * This is a `*.eval.ts` glob target run ONLY by the dedicated eval config /
 * `pnpm --filter companion eval:memory` — NOT by `pnpm test` (whose default
 * `*.test.ts` glob excludes it). Every metric line is logged with the `[eval]`
 * prefix so the runner output is greppable; the sensitivity check greps for the
 * `EXTRACTION_PRECISION_BELOW_THRESHOLD` marker.
 *
 * Determinism: fake embedder + scripted extractor + fixed `{ now: () => NOW }`
 * clock + a fresh in-memory store per test. No live realtime, no network.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { promoteSession } from "../memory/promote";
import { extractFacts } from "../memory/extract-facts";
import { policyFilter } from "../memory/policy-filter";
import { createScriptedExtractor } from "../memory/__fixtures__/scripted-extractor";
import { SqliteMemoryStore } from "../memory/sqlite-memory-store";
import { createFakeEmbedder } from "../memory/embedding";
import {
  selectMemoryForRender,
  renderMemoryBlock,
} from "../memory/render-memory";
import type { MemoryFact, MemoryScope } from "../memory/types";
import type { FactCandidate } from "../memory/promotion-types";

import { expectedFactId } from "./fact-id";
import { EVAL_THRESHOLDS } from "./thresholds";
import {
  precisionRecall,
  precisionAtK,
  deletionCompliance,
  crossScopeIsolation,
  temporalCorrectionAccuracy,
  injectedTokenCount,
} from "./metrics";
import {
  NOW,
  SCOPE,
  extractionScenario,
  retrievalScenario,
  nonMemoryScenario,
  deletionScenario,
  scopeIsolationScenario,
  sttScenario,
  temporalScenario,
  injectedTokenScenario,
  BROKEN_EXTRACTION_SCRIPT,
} from "./__fixtures__/eval-scenarios";

const embedder = createFakeEmbedder();
const EXTRACTOR_OVERRIDE = process.env.EVAL_INJECT_BREAK === "1";

let store: SqliteMemoryStore;

beforeEach(() => {
  store = new SqliteMemoryStore({ now: () => NOW });
});

afterEach(() => {
  store.close();
});

/** Build a MemoryFact from a candidate, embedding its text under the fake embedder. */
async function factFromCandidate(
  scope: MemoryScope,
  cand: FactCandidate,
): Promise<MemoryFact> {
  return {
    id: expectedFactId(scope, cand),
    scope,
    text: cand.text,
    kind: cand.kind,
    embedding: await embedder.embed(cand.text),
    importance: cand.importance,
    sourceSessionId: null,
    sourceTurnId: cand.sourceTurnId,
    createdAt: NOW,
    validAt: NOW,
    invalidAt: null,
    supersededBy: null,
  };
}

/** Active (retrievable) fact ids for a scope under an unbounded budget. */
async function activeFactIds(scope: MemoryScope): Promise<Set<string>> {
  const facts = await store.retrieve({
    scope,
    budgetTokens: Number.MAX_SAFE_INTEGER,
    now: NOW,
  });
  return new Set(facts.map((f) => f.id));
}

describe("memory eval — precision-first regression seed", () => {
  // Scenario A. Named EXACTLY for the sensitivity check's `-t` selector.
  it("extraction precision/recall meets threshold", async () => {
    const script = EXTRACTOR_OVERRIDE
      ? BROKEN_EXTRACTION_SCRIPT
      : extractionScenario.script;
    const { candidates } = await extractFacts(
      extractionScenario.transcript,
      createScriptedExtractor(script),
    );
    const admitted = candidates.filter(policyFilter);
    const actual = new Set(admitted.map((c) => expectedFactId(SCOPE, c)));
    const pr = precisionRecall(actual, extractionScenario.expectedFactIds);

    console.log(
      `[eval] extraction precision=${pr.precision} recall=${pr.recall} tp=${pr.truePositives} fp=${pr.falsePositives} fn=${pr.falseNegatives}`,
    );
    // Right-reason sensitivity marker: prints ONLY on a precision regression, so
    // the sensitivity check can prove the seeded break (not a load/config error)
    // was caught.
    if (pr.precision < EVAL_THRESHOLDS.extractionPrecisionMin) {
      console.log(
        `[eval] EXTRACTION_PRECISION_BELOW_THRESHOLD precision=${pr.precision}`,
      );
    }

    expect(pr.precision).toBeGreaterThanOrEqual(
      EVAL_THRESHOLDS.extractionPrecisionMin,
    );
    expect(pr.recall).toBeGreaterThanOrEqual(
      EVAL_THRESHOLDS.extractionRecallMin,
    );
  });

  // Scenario B.
  it("retrieval Precision@K and ordered top-K", async () => {
    for (const cand of retrievalScenario.seedCandidates) {
      await store.upsertFact(await factFromCandidate(SCOPE, cand));
    }
    const queryEmbedding = await embedder.embed(retrievalScenario.queryText);
    const ranked = await store.retrieve({
      scope: SCOPE,
      queryEmbedding,
      budgetTokens: Number.MAX_SAFE_INTEGER,
      weights: { recency: 0, importance: 0, relevance: 1 },
      now: NOW,
    });
    const rankedIds = ranked.map((f) => f.id);
    const pAtK = precisionAtK(rankedIds, retrievalScenario.relevantIds, 2);

    console.log(
      `[eval] retrieval Precision@2=${pAtK} top2=${JSON.stringify(rankedIds.slice(0, 2))}`,
    );

    expect(pAtK).toBeGreaterThanOrEqual(EVAL_THRESHOLDS.precisionAtKMin);
    // Precision@K is order-blind; the known-cosine ordering is verified by exact slice equality.
    expect(rankedIds.slice(0, 2)).toEqual(retrievalScenario.expectedTopK);
  });

  // Scenario C.
  it("non-memories (roleplay / jokes / assistant) are excluded", async () => {
    const result = await promoteSession({
      transcript: nonMemoryScenario.transcript,
      store,
      embedder,
      extractor: createScriptedExtractor(nonMemoryScenario.script),
      now: NOW,
      finalize: true,
    });
    const ids = await activeFactIds(SCOPE);
    const leaked = [...nonMemoryScenario.wouldBeFactIds].filter((id) =>
      ids.has(id),
    );

    console.log(
      `[eval] non-memories excluded: added=${result.added} leaked=${leaked.length}`,
    );

    expect(result.added).toBe(0);
    expect(leaked).toEqual([]);
  });

  // Scenario D.
  it("supersede then excluded (deletion compliance)", async () => {
    await promoteSession({
      transcript: deletionScenario.seedTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(deletionScenario.seedScript),
      now: NOW,
      finalize: true,
    });
    await promoteSession({
      transcript: deletionScenario.retractionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(deletionScenario.retractionScript),
      now: NOW,
      finalize: true,
    });
    const ids = await activeFactIds(SCOPE);
    const dc = deletionCompliance({
      retiredIds: [deletionScenario.expectedRetiredFactId],
      stillRetrievableIds: ids,
    });

    console.log(
      `[eval] deletion compliance: compliant=${dc.compliant} leaked=${dc.leaked.length}`,
    );

    expect(dc.compliant).toBe(true);
    const retired = await store.getFact(deletionScenario.expectedRetiredFactId);
    expect(retired?.invalidAt).not.toBeNull();
  });

  // Scenario E.
  it("scope isolation across user+character", async () => {
    await promoteSession({
      transcript: scopeIsolationScenario.primaryTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(scopeIsolationScenario.primaryScript),
      now: NOW,
      finalize: true,
    });
    await promoteSession({
      transcript: scopeIsolationScenario.foreignTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(scopeIsolationScenario.foreignScript),
      now: NOW,
      finalize: true,
    });
    const ids = await activeFactIds(scopeIsolationScenario.primaryScope);
    const ci = crossScopeIsolation({
      foreignExpectedIds: new Set([scopeIsolationScenario.foreignExpectedId]),
      retrievedIds: ids,
    });

    console.log(
      `[eval] scope isolation: isolated=${ci.isolated} leaked=${ci.leaked.length}`,
    );

    expect(ci.isolated).toBe(true);
  });

  // Scenario F.
  it("STT-misrecognized but admissible turn is not dropped", async () => {
    await promoteSession({
      transcript: sttScenario.transcript,
      store,
      embedder,
      extractor: createScriptedExtractor(sttScenario.script),
      now: NOW,
      finalize: true,
    });
    const ids = await activeFactIds(SCOPE);

    console.log(`[eval] STT admitted=${ids.has(sttScenario.expectedId)}`);

    expect(ids.has(sttScenario.expectedId)).toBe(true);
  });

  // Scenario G.
  it("temporal correction swaps the active fact", async () => {
    await promoteSession({
      transcript: temporalScenario.seedTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(temporalScenario.seedScript),
      now: NOW,
      finalize: true,
    });
    await promoteSession({
      transcript: temporalScenario.correctionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(temporalScenario.correctionScript),
      now: NOW,
      finalize: true,
    });
    const ids = await activeFactIds(SCOPE);
    const tc = temporalCorrectionAccuracy({
      expectedActiveId: temporalScenario.expectedActiveId,
      expectedRetiredId: temporalScenario.expectedRetiredId,
      activeIds: ids,
    });

    console.log(`[eval] temporal correction: correct=${tc.correct}`);

    expect(tc.correct).toBe(true);
    const retired = await store.getFact(temporalScenario.expectedRetiredId);
    expect(retired?.invalidAt).not.toBeNull();
    expect(retired?.supersededBy).toBe(temporalScenario.expectedActiveId);
  });

  // Scenario H — REPORT only (no wrapper-blind budget gate).
  it("reports injected-token count for a rendered block", async () => {
    const facts = await Promise.all(
      injectedTokenScenario.seedCandidates.map((cand) =>
        factFromCandidate(SCOPE, cand),
      ),
    );
    const sel = selectMemoryForRender({ facts, summaries: [] });
    const block = renderMemoryBlock(sel.facts, sel.summaries);
    const tokens = injectedTokenCount(block);

    console.log(
      `[eval] injected-token count = ${tokens} (rendered block over MEMORY_TOKEN_BUDGET=600 selection budget)`,
    );

    // Report-only: the rendered block includes fixed header/guard/delimiter
    // overhead that the selection text-budget never accounts for, so this is a
    // "render produced output" floor, NOT a `<= budget` gate.
    expect(tokens).toBeGreaterThan(0);
  });
});
