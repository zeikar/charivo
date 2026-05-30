import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { promoteSession } from "./promote";
import { SqliteMemoryStore } from "./sqlite-memory-store";
import { createFakeEmbedder } from "./embedding";
import { createScriptedExtractor } from "./__fixtures__/scripted-extractor";
import {
  NOW,
  SCOPE,
  firstSessionTranscript,
  firstSessionScript,
  correctionTranscript,
  correctionScript,
  forgetThatTranscript,
  forgetThatScript,
  thatsWrongTranscript,
  thatsWrongScript,
} from "./__fixtures__/transcripts";
import type { EmbeddingAdapter, MemoryFact } from "./types";
import type { FactExtractor, Transcript } from "./promotion-types";

// ---------------------------------------------------------------------------
// Shared fixtures — fresh store per test, fake (deterministic) embedder.
// ---------------------------------------------------------------------------

const embedder: EmbeddingAdapter = createFakeEmbedder();

let store: SqliteMemoryStore;

beforeEach(() => {
  store = new SqliteMemoryStore({ now: () => NOW });
});

afterEach(() => {
  store.close();
});

/** Retrieve all active facts for SCOPE under an unbounded budget. */
function activeFacts(s: SqliteMemoryStore): Promise<MemoryFact[]> {
  return s.retrieve({
    scope: SCOPE,
    budgetTokens: Number.MAX_SAFE_INTEGER,
    now: NOW,
  });
}

/** An extractor whose extract() rejects — to exercise the failed-finalize path. */
const throwingExtractor: FactExtractor = {
  extract(): Promise<never> {
    return Promise.reject(new Error("extraction failed"));
  },
};

// ---------------------------------------------------------------------------
// 1. Extraction + admission + persisted effects
// ---------------------------------------------------------------------------

describe("promoteSession — extraction, admission, persisted effects", () => {
  it("persists exactly the two admitted user candidates; drops assistant + low-importance", async () => {
    const result = await promoteSession({
      transcript: firstSessionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });

    expect(result).toEqual({
      added: 2,
      superseded: 0,
      invalidated: 0,
      noop: 0,
      dropped: 2, // assistant-sourced (extractFacts) + low-importance (policyFilter)
      relationshipUpdated: true,
    });

    const facts = await activeFacts(store);
    expect(facts).toHaveLength(2);

    const byTurn = new Map(facts.map((f) => [f.sourceTurnId, f]));

    const coffee = byTurn.get("u1");
    expect(coffee).toBeDefined();
    expect(coffee!.text).toBe("I take my coffee with milk");
    expect(coffee!.kind).toBe("preference");
    expect(coffee!.importance).toBe(0.8);

    const teacher = byTurn.get("u2");
    expect(teacher).toBeDefined();
    expect(teacher!.text).toBe("I work as a teacher");
    expect(teacher!.kind).toBe("biographical");
    expect(teacher!.importance).toBe(0.7);

    // No fact from the assistant turn (a1) or the low-importance turn (u3).
    expect(byTurn.has("a1")).toBe(false);
    expect(byTurn.has("u3")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Merge-path — supersede (UPDATE) and invalidate (DELETE)
// ---------------------------------------------------------------------------

describe("promoteSession — merge path", () => {
  it("supersedes the old preference and invalidates the retracted biographical fact", async () => {
    await promoteSession({
      transcript: firstSessionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });

    // Capture ids of the seeded facts before the correction.
    const seeded = await activeFacts(store);
    const oldCoffee = seeded.find((f) => f.sourceTurnId === "u1")!;
    const oldTeacher = seeded.find((f) => f.sourceTurnId === "u2")!;

    const result = await promoteSession({
      transcript: correctionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(correctionScript),
      now: NOW,
      finalize: true,
    });

    expect(result.superseded).toBe(1);
    expect(result.invalidated).toBe(1);
    expect(result.added).toBe(0);

    // Active facts: only the new "I take my coffee black" fact remains.
    const active = await activeFacts(store);
    expect(active).toHaveLength(1);
    const tea = active[0];
    expect(tea.text).toBe("I take my coffee black");
    expect(tea.sourceTurnId).toBe("u4");

    // The old coffee fact is inactive and points at the new tea fact.
    const coffeeRow = await store.getFact(oldCoffee.id);
    expect(coffeeRow).not.toBeNull();
    expect(coffeeRow!.invalidAt).not.toBeNull();
    expect(coffeeRow!.supersededBy).toBe(tea.id);

    // The teacher fact is invalidated with NO replacement link.
    const teacherRow = await store.getFact(oldTeacher.id);
    expect(teacherRow).not.toBeNull();
    expect(teacherRow!.invalidAt).not.toBeNull();
    expect(teacherRow!.supersededBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotency #1 — first-session rerun
// ---------------------------------------------------------------------------

describe("promoteSession — idempotency, first-session rerun", () => {
  it("rerunning the first session produces no duplicate rows and advances the relationship once", async () => {
    const handle = new DatabaseSync(":memory:");
    const s = new SqliteMemoryStore({ db: handle, now: () => NOW });
    try {
      const run1 = await promoteSession({
        transcript: firstSessionTranscript,
        store: s,
        embedder,
        extractor: createScriptedExtractor(firstSessionScript),
        now: NOW,
        finalize: true,
      });
      expect(run1.relationshipUpdated).toBe(true);

      const after1 = await s.retrieve({
        scope: SCOPE,
        budgetTokens: Number.MAX_SAFE_INTEGER,
        now: NOW,
      });
      const ids1 = after1.map((f) => f.id).sort();
      const rel1 = await s.getRelationship(SCOPE);
      expect(rel1!.sessionCount).toBe(1);

      const run2 = await promoteSession({
        transcript: firstSessionTranscript,
        store: s,
        embedder,
        extractor: createScriptedExtractor(firstSessionScript),
        now: NOW,
        finalize: true,
      });
      expect(run2.relationshipUpdated).toBe(false);

      const after2 = await s.retrieve({
        scope: SCOPE,
        budgetTokens: Number.MAX_SAFE_INTEGER,
        now: NOW,
      });
      const ids2 = after2.map((f) => f.id).sort();

      // Identical active fact ids and field values across runs.
      expect(ids2).toEqual(ids1);
      for (const f of after2) {
        const prev = after1.find((p) => p.id === f.id)!;
        expect(f).toEqual(prev);
      }

      // Exactly one session row and one row per fact id.
      const sessionCount = (
        handle
          .prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = 's1'")
          .get() as { n: number }
      ).n;
      expect(sessionCount).toBe(1);

      const factCount = (
        handle.prepare("SELECT COUNT(*) AS n FROM facts").get() as { n: number }
      ).n;
      expect(factCount).toBe(2);

      const rel2 = await s.getRelationship(SCOPE);
      expect(rel2!.sessionCount).toBe(1);
    } finally {
      s.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Idempotency #2 — correction/retraction rerun [B4]
// ---------------------------------------------------------------------------

describe("promoteSession — idempotency, correction rerun", () => {
  it("rerunning the correction does not resurrect the retraction or duplicate the update", async () => {
    const handle = new DatabaseSync(":memory:");
    const s = new SqliteMemoryStore({ db: handle, now: () => NOW });
    try {
      // Seed the first session, then run the correction once.
      await promoteSession({
        transcript: firstSessionTranscript,
        store: s,
        embedder,
        extractor: createScriptedExtractor(firstSessionScript),
        now: NOW,
        finalize: true,
      });
      await promoteSession({
        transcript: correctionTranscript,
        store: s,
        embedder,
        extractor: createScriptedExtractor(correctionScript),
        now: NOW,
        finalize: true,
      });

      const active1 = await s.retrieve({
        scope: SCOPE,
        budgetTokens: Number.MAX_SAFE_INTEGER,
        now: NOW,
      });
      const ids1 = active1.map((f) => f.id).sort();
      const factCount1 = (
        handle.prepare("SELECT COUNT(*) AS n FROM facts").get() as { n: number }
      ).n;
      const rel1 = await s.getRelationship(SCOPE);

      // Re-run the correction.
      const rerun = await promoteSession({
        transcript: correctionTranscript,
        store: s,
        embedder,
        extractor: createScriptedExtractor(correctionScript),
        now: NOW,
        finalize: true,
      });

      // Retraction → NOOP on rerun (not ADD); near-dup tea → NOOP (no new row).
      expect(rerun.added).toBe(0);
      expect(rerun.superseded).toBe(0);
      expect(rerun.invalidated).toBe(0);
      expect(rerun.relationshipUpdated).toBe(false);

      const active2 = await s.retrieve({
        scope: SCOPE,
        budgetTokens: Number.MAX_SAFE_INTEGER,
        now: NOW,
      });
      const ids2 = active2.map((f) => f.id).sort();
      const factCount2 = (
        handle.prepare("SELECT COUNT(*) AS n FROM facts").get() as { n: number }
      ).n;
      const rel2 = await s.getRelationship(SCOPE);

      // No resurrected retraction fact, no duplicated update row.
      expect(ids2).toEqual(ids1);
      expect(factCount2).toBe(factCount1);
      // Only the coffee-black fact is active; the teacher fact stays invalidated.
      expect(active2).toHaveLength(1);
      expect(active2[0].text).toBe("I take my coffee black");

      // Relationship session count unchanged across the two correction runs.
      expect(rel2!.sessionCount).toBe(rel1!.sessionCount);
    } finally {
      s.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Checkpoint-then-finalize
// ---------------------------------------------------------------------------

describe("promoteSession — checkpoint then finalize", () => {
  it("a checkpoint does not finalize or advance the relationship; the finalize does", async () => {
    const checkpoint = await promoteSession({
      transcript: firstSessionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: false,
    });
    expect(checkpoint.relationshipUpdated).toBe(false);
    expect(await store.isSessionFinalized(SCOPE, "s1")).toBe(false);
    expect(await store.getRelationship(SCOPE)).toBeNull();

    const finalized = await promoteSession({
      transcript: firstSessionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });
    expect(finalized.relationshipUpdated).toBe(true);
    expect(await store.isSessionFinalized(SCOPE, "s1")).toBe(true);

    const rel = await store.getRelationship(SCOPE);
    expect(rel!.sessionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Abnormal-end (endedAt null) [B5]/[M9]
// ---------------------------------------------------------------------------

describe("promoteSession — abnormal end (endedAt null)", () => {
  it("finalizes and advances once even when endedAt stays null", async () => {
    const variant: Transcript = { ...firstSessionTranscript, endedAt: null };

    const run1 = await promoteSession({
      transcript: variant,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });
    expect(run1.relationshipUpdated).toBe(true);
    expect(await store.isSessionFinalized(SCOPE, "s1")).toBe(true);
    expect((await store.getRelationship(SCOPE))!.sessionCount).toBe(1);

    const run2 = await promoteSession({
      transcript: variant,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });
    expect(run2.relationshipUpdated).toBe(false);
    expect((await store.getRelationship(SCOPE))!.sessionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Failed-then-retried finalize [B6]/[B7]
// ---------------------------------------------------------------------------

describe("promoteSession — failed then retried finalize", () => {
  it("a failed extraction leaves the session unfinalized; a retry advances exactly once", async () => {
    // The extractor throws → promoteSession rejects, and the atomic
    // finalizeSession never runs (no marker, no relationship advance).
    await expect(
      promoteSession({
        transcript: firstSessionTranscript,
        store,
        embedder,
        extractor: throwingExtractor,
        now: NOW,
        finalize: true,
      }),
    ).rejects.toThrow();

    expect(await store.isSessionFinalized(SCOPE, "s1")).toBe(false);
    expect(await store.getRelationship(SCOPE)).toBeNull();

    // Retry with the working extractor → advances once.
    const retry = await promoteSession({
      transcript: firstSessionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });
    expect(retry.relationshipUpdated).toBe(true);
    expect(await store.isSessionFinalized(SCOPE, "s1")).toBe(true);
    expect((await store.getRelationship(SCOPE))!.sessionCount).toBe(1);

    // A third run does not advance again.
    const third = await promoteSession({
      transcript: firstSessionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });
    expect(third.relationshipUpdated).toBe(false);
    expect((await store.getRelationship(SCOPE))!.sessionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Scripted retraction (forget that / that's wrong) → excluded from next retrieve
//
// Deterministic, scripted fake extractor — NOT the live spoken path. Replacement
// correction is already covered by the "merge path" describe above
// (coffee-with-milk → coffee-black supersede); these tests only cover the new
// pure-retraction (DELETE/invalidate) marker path.
// ---------------------------------------------------------------------------

describe("promoteSession — scripted retraction (forget that / that's wrong)", () => {
  it("'forget that' retraction invalidates the teacher fact and excludes it from the next retrieve", async () => {
    // Seed the biographical "I work as a teacher" fact.
    await promoteSession({
      transcript: firstSessionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });
    const teacher = (await activeFacts(store)).find(
      (f) => f.sourceTurnId === "u2",
    )!;
    expect(teacher).toBeDefined();

    const result = await promoteSession({
      transcript: forgetThatTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(forgetThatScript),
      now: NOW,
      finalize: true,
    });

    // Pure retraction → DELETE (invalidate), nothing added.
    expect(result.invalidated).toBe(1);
    expect(result.added).toBe(0);

    // Core "excluded from the next retrieve" check.
    const active = await activeFacts(store);
    expect(active.map((f) => f.sourceTurnId)).not.toContain("u2");

    // Invalidated (soft) with NO replacement link.
    const teacherRow = await store.getFact(teacher.id);
    expect(teacherRow!.invalidAt).not.toBeNull();
    expect(teacherRow!.supersededBy).toBeNull();
  });

  it("'that's wrong' retraction (Task-1 marker) invalidates the teacher fact and excludes it from the next retrieve", async () => {
    await promoteSession({
      transcript: firstSessionTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(firstSessionScript),
      now: NOW,
      finalize: true,
    });
    const teacher = (await activeFacts(store)).find(
      (f) => f.sourceTurnId === "u2",
    )!;
    expect(teacher).toBeDefined();

    const result = await promoteSession({
      transcript: thatsWrongTranscript,
      store,
      embedder,
      extractor: createScriptedExtractor(thatsWrongScript),
      now: NOW,
      finalize: true,
    });

    expect(result.invalidated).toBe(1);
    expect(result.added).toBe(0);

    const active = await activeFacts(store);
    expect(active.map((f) => f.sourceTurnId)).not.toContain("u2");

    const teacherRow = await store.getFact(teacher.id);
    expect(teacherRow!.invalidAt).not.toBeNull();
    expect(teacherRow!.supersededBy).toBeNull();
  });
});
