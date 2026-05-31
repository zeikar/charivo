import { describe, it, expect, beforeEach } from "vitest";

import {
  LocalStorageMemoryStore,
  createInMemoryStorage,
  MEMORY_STORAGE_KEYS,
  type KeyValueStorage,
} from "./local-storage-memory-store";
import { createFakeEmbedder } from "./embedding";
import { estimateTokens } from "./scoring";
import { updateRelationship, deriveRelationshipSignals } from "./relationship";
import type { RelationshipSignals, Transcript } from "./promotion-types";
import type {
  MemoryFact,
  MemoryScope,
  RelationshipState,
  SessionRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Fixed clock — every test uses this constant to stay deterministic.
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

function makeFact(
  overrides: Partial<MemoryFact> & { scope: MemoryScope },
): MemoryFact {
  return {
    id: crypto.randomUUID(),
    text: "a test fact",
    kind: "other",
    embedding: [],
    importance: 0.5,
    sourceSessionId: null,
    sourceTurnId: null,
    createdAt: NOW,
    validAt: NOW,
    invalidAt: null,
    supersededBy: null,
    ...overrides,
  };
}

const SCOPE_A: MemoryScope = { userId: "userA", characterId: "charA" };

let storage: KeyValueStorage;
let store: LocalStorageMemoryStore;

beforeEach(() => {
  storage = createInMemoryStorage();
  store = new LocalStorageMemoryStore({ storage, now: () => NOW });
});

// Raw-storage inspectors — replace the SQLite version's direct SQL COUNT/SELECT.
function storedSessions(): Record<
  string,
  { finalizedAt: number | null; summary: string | null }
> {
  const raw = storage.getItem(MEMORY_STORAGE_KEYS.sessions);
  return raw ? JSON.parse(raw) : {};
}
function storedFactCount(): number {
  const raw = storage.getItem(MEMORY_STORAGE_KEYS.facts);
  return raw ? Object.keys(JSON.parse(raw)).length : 0;
}
function finalizedAtOf(scope: MemoryScope, id: string): number | null {
  const key = JSON.stringify([scope.userId, scope.characterId, id]);
  return storedSessions()[key]?.finalizedAt ?? null;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("construction", () => {
  it("writes through the injected storage (used in preference to any ambient localStorage)", async () => {
    const injected = createInMemoryStorage();
    const s = new LocalStorageMemoryStore({
      storage: injected,
      now: () => NOW,
    });
    await s.putRelationship({
      scope: SCOPE_A,
      rapport: 0,
      sessionCount: 1,
      lastSeenAt: NOW,
      addressStyle: "unknown",
      flags: {},
    });
    expect(injected.getItem(MEMORY_STORAGE_KEYS.relationships)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scope isolation
// ---------------------------------------------------------------------------

describe("scope isolation", () => {
  it("retrieve for scope A excludes facts from differing characterId and differing userId", async () => {
    const scopeA = SCOPE_A;
    const scopeB1: MemoryScope = { userId: "userA", characterId: "charB" };
    const scopeB2: MemoryScope = { userId: "userB", characterId: "charA" };

    const factA = makeFact({ scope: scopeA });
    const factB1 = makeFact({ scope: scopeB1 });
    const factB2 = makeFact({ scope: scopeB2 });

    await store.upsertFact(factA);
    await store.upsertFact(factB1);
    await store.upsertFact(factB2);

    const results = await store.retrieve({
      scope: scopeA,
      budgetTokens: 999999,
      now: NOW,
    });

    const ids = results.map((f) => f.id);
    expect(ids).toContain(factA.id);
    expect(ids).not.toContain(factB1.id);
    expect(ids).not.toContain(factB2.id);
  });
});

// ---------------------------------------------------------------------------
// Supersede / invalidate exclusion (including null `by`)
// ---------------------------------------------------------------------------

describe("supersede/invalidate exclusion", () => {
  it("excludes invalidated, superseded (with link), and superseded (null link) facts; keeps active", async () => {
    const scope = SCOPE_A;
    const idA = makeFact({ scope, text: "fact A" });
    const idB = makeFact({ scope, text: "fact B" });
    const idC = makeFact({ scope, text: "fact C" });
    const active = makeFact({ scope, text: "still active" });

    await store.upsertFact(idA);
    await store.upsertFact(idB);
    await store.upsertFact(idC);
    await store.upsertFact(active);

    await store.invalidate(idA.id);
    await store.supersede(idB.id, "idNew");
    await store.supersede(idC.id, null); // null replacement — still sets invalidAt

    const results = await store.retrieve({
      scope,
      budgetTokens: 999999,
      now: NOW,
    });

    const ids = results.map((f) => f.id);
    expect(ids).not.toContain(idA.id);
    expect(ids).not.toContain(idB.id);
    expect(ids).not.toContain(idC.id);
    expect(ids).toContain(active.id);

    // invalidate does not set a replacement link; supersede(null) sets none either.
    expect((await store.getFact(idA.id))!.supersededBy).toBeNull();
    expect((await store.getFact(idB.id))!.supersededBy).toBe("idNew");
    expect((await store.getFact(idC.id))!.supersededBy).toBeNull();
  });

  it("supersede/invalidate on an absent id is a no-op (does not create a row)", async () => {
    await store.supersede("nope", "x");
    await store.invalidate("nope");
    expect(storedFactCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// replaceFact (atomic upsert-new + supersede-old)
// ---------------------------------------------------------------------------

describe("replaceFact", () => {
  it("activates the new fact and retires the old one, linked by supersededBy", async () => {
    const scope = SCOPE_A;
    const oldFact = makeFact({ scope, text: "I take my coffee with milk" });
    const newFact = makeFact({ scope, text: "I take my coffee black" });

    await store.upsertFact(oldFact);
    await store.replaceFact(oldFact.id, newFact);

    const active = await store.retrieve({
      scope,
      budgetTokens: 999999,
      now: NOW,
    });
    expect(active.map((f) => f.id)).toEqual([newFact.id]);

    const oldRow = await store.getFact(oldFact.id);
    expect(oldRow).not.toBeNull();
    expect(oldRow!.invalidAt).not.toBeNull();
    expect(oldRow!.supersededBy).toBe(newFact.id);

    expect((await store.getFact(newFact.id))!.invalidAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ordering: recency + importance (no queryEmbedding, large budget)
// ---------------------------------------------------------------------------

describe("ordering", () => {
  it("higher importance outranks lower importance at equal createdAt", async () => {
    const scope = SCOPE_A;
    const low = makeFact({ scope, importance: 0.1, createdAt: NOW });
    const high = makeFact({ scope, importance: 0.9, createdAt: NOW });

    await store.upsertFact(low);
    await store.upsertFact(high);

    const results = await store.retrieve({
      scope,
      budgetTokens: 999999,
      now: NOW,
    });

    const ids = results.map((f) => f.id);
    expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low.id));
  });

  it("more recent fact outranks older fact at equal importance", async () => {
    const scope = SCOPE_A;
    const older = makeFact({
      scope,
      importance: 0.5,
      createdAt: NOW - 1_000_000,
    });
    const newer = makeFact({ scope, importance: 0.5, createdAt: NOW });

    await store.upsertFact(older);
    await store.upsertFact(newer);

    const results = await store.retrieve({
      scope,
      budgetTokens: 999999,
      now: NOW,
    });

    const ids = results.map((f) => f.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });
});

// ---------------------------------------------------------------------------
// Budget cap — SKIP algorithm
// ---------------------------------------------------------------------------

describe("budget cap (SKIP algorithm)", () => {
  it("total tokens in result set does not exceed budgetTokens", async () => {
    const scope = SCOPE_A;
    const facts = Array.from({ length: 5 }, (_, i) =>
      makeFact({
        scope,
        text: `12345678${i}`.slice(0, 8), // 8 chars → 2 tokens
        importance: 0.5,
        createdAt: NOW,
      }),
    );
    for (const f of facts) await store.upsertFact(f);

    const budgetTokens = 5; // fits at most 2 facts (each costs 2 tokens)
    const results = await store.retrieve({ scope, budgetTokens, now: NOW });

    const totalTokens = results.reduce(
      (sum, f) => sum + estimateTokens(f.text),
      0,
    );
    expect(totalTokens).toBeLessThanOrEqual(budgetTokens);
    expect(results.length).toBeGreaterThan(0);
  });

  it("SKIP-not-stop: a too-large top-scored fact is skipped; a smaller lower-scored fact is still included", async () => {
    const scope = SCOPE_A;
    const bigText = "a".repeat(40); // 10 tokens
    const bigFact = makeFact({
      scope,
      text: bigText,
      importance: 1.0,
      createdAt: NOW,
    });
    const smallText = "abcd"; // 1 token
    const smallFact = makeFact({
      scope,
      text: smallText,
      importance: 0.1,
      createdAt: NOW,
    });

    await store.upsertFact(bigFact);
    await store.upsertFact(smallFact);

    const budgetTokens = 5;
    expect(estimateTokens(bigText)).toBeGreaterThan(budgetTokens);
    expect(estimateTokens(smallText)).toBeLessThanOrEqual(budgetTokens);

    const results = await store.retrieve({ scope, budgetTokens, now: NOW });
    const ids = results.map((f) => f.id);
    expect(ids).not.toContain(bigFact.id);
    expect(ids).toContain(smallFact.id);
  });

  it("a single fact larger than the whole budget is excluded", async () => {
    const scope = SCOPE_A;
    const hugeText = "x".repeat(100); // 25 tokens
    const hugeFact = makeFact({ scope, text: hugeText, importance: 1.0 });

    await store.upsertFact(hugeFact);

    const budgetTokens = 10;
    expect(estimateTokens(hugeText)).toBeGreaterThan(budgetTokens);

    const results = await store.retrieve({ scope, budgetTokens, now: NOW });
    expect(results.map((f) => f.id)).not.toContain(hugeFact.id);
  });
});

// ---------------------------------------------------------------------------
// Relevance scoring with queryEmbedding
// ---------------------------------------------------------------------------

describe("relevance with queryEmbedding", () => {
  it("semantically-closer fact ranks first when relevance weight dominates", async () => {
    const scope = SCOPE_A;
    const embedder = createFakeEmbedder();

    const textClose = "apple banana cherry";
    const textFar = "quantum physics nuclear reactor";

    const embeddingClose = await embedder.embed(textClose);
    const embeddingFar = await embedder.embed(textFar);
    const queryEmbedding = await embedder.embed(textClose);

    const closeFact = makeFact({
      scope,
      text: textClose,
      embedding: embeddingClose,
      importance: 0.5,
      createdAt: NOW,
    });
    const farFact = makeFact({
      scope,
      text: textFar,
      embedding: embeddingFar,
      importance: 0.5,
      createdAt: NOW,
    });

    await store.upsertFact(closeFact);
    await store.upsertFact(farFact);

    const results = await store.retrieve({
      scope,
      budgetTokens: 999999,
      queryEmbedding,
      weights: { recency: 0, importance: 0, relevance: 1 },
      now: NOW,
    });

    const ids = results.map((f) => f.id);
    expect(ids.indexOf(closeFact.id)).toBeLessThan(ids.indexOf(farFact.id));
  });
});

// ---------------------------------------------------------------------------
// Relationship round-trip + upsert + scope independence
// ---------------------------------------------------------------------------

describe("relationship", () => {
  const scopeA = SCOPE_A;
  const scopeB: MemoryScope = { userId: "userA", characterId: "charB" };

  const stateA: RelationshipState = {
    scope: scopeA,
    rapport: 0.75,
    sessionCount: 3,
    lastSeenAt: NOW,
    addressStyle: "casual",
    flags: { has_been_thanked: true, declined_personal_questions: false },
  };

  it("getRelationship returns null when no state has been stored", async () => {
    expect(await store.getRelationship(scopeA)).toBeNull();
  });

  it("putRelationship then getRelationship returns deep-equal state (including flags)", async () => {
    await store.putRelationship(stateA);
    expect(await store.getRelationship(scopeA)).toEqual(stateA);
  });

  it("second putRelationship upserts (no duplicate) and reflects updated values", async () => {
    await store.putRelationship(stateA);
    const updatedA: RelationshipState = {
      ...stateA,
      rapport: 0.9,
      sessionCount: 5,
      flags: { has_been_thanked: true, declined_personal_questions: true },
    };
    await store.putRelationship(updatedA);

    const result = await store.getRelationship(scopeA);
    expect(result).toEqual(updatedA);
    expect(result?.rapport).toBe(0.9);
    expect(result?.sessionCount).toBe(5);
  });

  it("scope B relationship is independent of scope A", async () => {
    await store.putRelationship(stateA);
    expect(await store.getRelationship(scopeB)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Session round-trip + idempotency
// ---------------------------------------------------------------------------

describe("session round-trip and idempotency", () => {
  it("saveSession twice with same id produces exactly one row; second call's summary wins", async () => {
    const sessionId = crypto.randomUUID();
    const rec1: SessionRecord = {
      id: sessionId,
      scope: SCOPE_A,
      startedAt: NOW - 5000,
      endedAt: NOW,
      summary: "first summary",
      turnCount: 3,
    };
    const rec2: SessionRecord = {
      ...rec1,
      summary: "updated summary",
      turnCount: 5,
    };

    await store.saveSession(rec1);
    await store.saveSession(rec2);

    expect(Object.keys(storedSessions())).toHaveLength(1);
    const recent = await store.getRecentSummaries(SCOPE_A, 5);
    expect(recent).toHaveLength(1);
    expect(recent[0].summary).toBe("updated summary");
  });

  it("getRecentSummaries returns newest-first and excludes null/blank summaries", async () => {
    await store.saveSession({
      id: "s-old",
      scope: SCOPE_A,
      startedAt: NOW - 3000,
      endedAt: NOW - 3000,
      summary: "older",
      turnCount: 1,
    });
    await store.saveSession({
      id: "s-new",
      scope: SCOPE_A,
      startedAt: NOW - 1000,
      endedAt: NOW - 1000,
      summary: "newer",
      turnCount: 1,
    });
    await store.saveSession({
      id: "s-blank",
      scope: SCOPE_A,
      startedAt: NOW,
      endedAt: NOW,
      summary: "   ",
      turnCount: 1,
    });
    await store.saveSession({
      id: "s-null",
      scope: SCOPE_A,
      startedAt: NOW,
      endedAt: NOW,
      summary: null,
      turnCount: 1,
    });

    const recent = await store.getRecentSummaries(SCOPE_A, 5);
    expect(recent.map((r) => r.summary)).toEqual(["newer", "older"]);
  });
});

// ---------------------------------------------------------------------------
// Finalization ledger
// ---------------------------------------------------------------------------

describe("finalization ledger", () => {
  function makeTranscript(sessionId: string, scope: MemoryScope): Transcript {
    return {
      sessionId,
      scope,
      startedAt: NOW - 1000,
      endedAt: NOW,
      turns: [
        { id: "t1", role: "user", text: "thanks, that was great", at: NOW },
      ],
    };
  }

  function saveSessionRec(id: string, scope: MemoryScope): Promise<void> {
    return store.saveSession({
      id,
      scope,
      startedAt: NOW - 1000,
      endedAt: NOW,
      summary: null,
      turnCount: 1,
    });
  }

  it("saved session: isSessionFinalized false → finalizeSession true → finalized true and relationship reduced", async () => {
    const id = "sess-1";
    await saveSessionRec(id, SCOPE_A);

    expect(await store.isSessionFinalized(SCOPE_A, id)).toBe(false);

    const signals = deriveRelationshipSignals(makeTranscript(id, SCOPE_A));
    const result = await store.finalizeSession(
      SCOPE_A,
      id,
      signals,
      NOW,
      updateRelationship,
    );
    expect(result).toBe(true);
    expect(await store.isSessionFinalized(SCOPE_A, id)).toBe(true);

    const rel = await store.getRelationship(SCOPE_A);
    expect(rel?.sessionCount).toBe(1);
    expect(rel?.lastSeenAt).toBe(NOW);
  });

  it("[B7] second finalizeSession for same id returns false, relationship unchanged, marker keeps its first value", async () => {
    const id = "sess-b7";
    await saveSessionRec(id, SCOPE_A);
    const signals = deriveRelationshipSignals(makeTranscript(id, SCOPE_A));

    const FIRST_T = NOW;
    expect(
      await store.finalizeSession(
        SCOPE_A,
        id,
        signals,
        FIRST_T,
        updateRelationship,
      ),
    ).toBe(true);
    expect(finalizedAtOf(SCOPE_A, id)).toBe(FIRST_T);

    const SECOND_T = NOW + 5000;
    expect(
      await store.finalizeSession(
        SCOPE_A,
        id,
        signals,
        SECOND_T,
        updateRelationship,
      ),
    ).toBe(false);

    expect((await store.getRelationship(SCOPE_A))?.sessionCount).toBe(1);
    expect(finalizedAtOf(SCOPE_A, id)).toBe(FIRST_T); // marker unchanged
  });

  it("finalizeSession on a never-saved session returns false and leaves the relationship unchanged", async () => {
    const signals = deriveRelationshipSignals(
      makeTranscript("never-saved", SCOPE_A),
    );
    const result = await store.finalizeSession(
      SCOPE_A,
      "never-saved",
      signals,
      NOW,
      updateRelationship,
    );
    expect(result).toBe(false);
    expect(await store.getRelationship(SCOPE_A)).toBeNull();
  });

  it("two sessions for the same scope each finalize once; sessionCount reaches 2 with no lost increment", async () => {
    await saveSessionRec("sess-c1", SCOPE_A);
    await saveSessionRec("sess-c2", SCOPE_A);

    const signals: RelationshipSignals = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 0,
    };

    expect(
      await store.finalizeSession(
        SCOPE_A,
        "sess-c1",
        signals,
        NOW,
        updateRelationship,
      ),
    ).toBe(true);
    expect(
      await store.finalizeSession(
        SCOPE_A,
        "sess-c2",
        signals,
        NOW,
        updateRelationship,
      ),
    ).toBe(true);

    expect((await store.getRelationship(SCOPE_A))?.sessionCount).toBe(2);
  });

  it("[B5] a saveSession upsert after finalize (delayed checkpoint) leaves the session finalized", async () => {
    const id = "sess-b5";
    await saveSessionRec(id, SCOPE_A);

    const signals: RelationshipSignals = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 0,
    };
    await store.finalizeSession(SCOPE_A, id, signals, NOW, updateRelationship);
    expect(await store.isSessionFinalized(SCOPE_A, id)).toBe(true);

    // Delayed checkpoint writes endedAt: null and must never clear the marker.
    await store.saveSession({
      id,
      scope: SCOPE_A,
      startedAt: NOW - 1000,
      endedAt: null,
      summary: null,
      turnCount: 2,
    });

    expect(await store.isSessionFinalized(SCOPE_A, id)).toBe(true);
  });

  it("[F2] same sessionId across two scopes: independent rows; finalizing one leaves the other unfinalized and able to finalize on its own", async () => {
    const SCOPE_B: MemoryScope = { userId: "userB", characterId: "charB" };
    const sharedId = "shared-session-id";

    await saveSessionRec(sharedId, SCOPE_A);
    await saveSessionRec(sharedId, SCOPE_B);

    // Scoped composite key → two independent rows, not one overwritten row.
    expect(Object.keys(storedSessions())).toHaveLength(2);

    expect(
      await store.finalizeSession(
        SCOPE_A,
        sharedId,
        deriveRelationshipSignals(makeTranscript(sharedId, SCOPE_A)),
        NOW,
        updateRelationship,
      ),
    ).toBe(true);

    expect(await store.isSessionFinalized(SCOPE_A, sharedId)).toBe(true);
    expect(await store.isSessionFinalized(SCOPE_B, sharedId)).toBe(false);

    expect(
      await store.finalizeSession(
        SCOPE_B,
        sharedId,
        deriveRelationshipSignals(makeTranscript(sharedId, SCOPE_B)),
        NOW,
        updateRelationship,
      ),
    ).toBe(true);
    expect((await store.getRelationship(SCOPE_A))?.sessionCount).toBe(1);
    expect((await store.getRelationship(SCOPE_B))?.sessionCount).toBe(1);
  });

  it("rolls back the marker when the relationship write fails, so a retry can finalize exactly once", async () => {
    // Wrap the in-memory storage so the relationships write can be forced to
    // throw (simulating a quota / storage failure mid-finalize).
    const base = createInMemoryStorage();
    let failRelWrite = true;
    const flaky: KeyValueStorage = {
      getItem: (k) => base.getItem(k),
      setItem: (k, v) => {
        if (failRelWrite && k === MEMORY_STORAGE_KEYS.relationships) {
          throw new Error("quota exceeded");
        }
        base.setItem(k, v);
      },
      removeItem: (k) => base.removeItem(k),
    };
    const s = new LocalStorageMemoryStore({ storage: flaky, now: () => NOW });

    await s.saveSession({
      id: "sess-flaky",
      scope: SCOPE_A,
      startedAt: NOW - 1000,
      endedAt: NOW,
      summary: null,
      turnCount: 1,
    });
    const signals: RelationshipSignals = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 0,
    };

    // Relationship write throws → finalize rejects AND the marker is rolled back.
    await expect(
      s.finalizeSession(
        SCOPE_A,
        "sess-flaky",
        signals,
        NOW,
        updateRelationship,
      ),
    ).rejects.toThrow();
    expect(await s.isSessionFinalized(SCOPE_A, "sess-flaky")).toBe(false);
    expect(await s.getRelationship(SCOPE_A)).toBeNull();

    // Storage recovers → the retry advances the relationship exactly once.
    failRelWrite = false;
    expect(
      await s.finalizeSession(
        SCOPE_A,
        "sess-flaky",
        signals,
        NOW,
        updateRelationship,
      ),
    ).toBe(true);
    expect(await s.isSessionFinalized(SCOPE_A, "sess-flaky")).toBe(true);
    expect((await s.getRelationship(SCOPE_A))?.sessionCount).toBe(1);
  });
});
