import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { SqliteMemoryStore } from "./sqlite-memory-store";
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

const NOW = 1_700_000_000_000; // arbitrary epoch-ms anchor

// ---------------------------------------------------------------------------
// Fact factory
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared store — rebuilt fresh for each test.
// ---------------------------------------------------------------------------

const SCOPE_A: MemoryScope = { userId: "userA", characterId: "charA" };

let store: SqliteMemoryStore;

beforeEach(() => {
  store = new SqliteMemoryStore({ now: () => NOW });
});

afterEach(() => {
  store.close();
});

// ---------------------------------------------------------------------------
// Scope isolation
// ---------------------------------------------------------------------------

describe("scope isolation", () => {
  it("retrieve for scope A excludes facts from differing characterId (scope B1) and differing userId (scope B2)", async () => {
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
  it("excludes invalidated, superseded (with link), and superseded (null link) facts; returns remaining active facts", async () => {
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
    await store.supersede(idC.id, null); // null replacement — still sets invalid_at

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
  });
});

// ---------------------------------------------------------------------------
// Atomic replaceFact ([M1])
// ---------------------------------------------------------------------------

describe("replaceFact (atomic upsert-new + supersede-old)", () => {
  it("activates the new fact and retires the old one, linked by supersededBy", async () => {
    const scope = SCOPE_A;
    const oldFact = makeFact({ scope, text: "I take my coffee with milk" });
    const newFact = makeFact({ scope, text: "I take my coffee black" });

    await store.upsertFact(oldFact);
    await store.replaceFact(oldFact.id, newFact);

    // New fact is active; old fact is inactive and points at the new one.
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

    const newRow = await store.getFact(newFact.id);
    expect(newRow!.invalidAt).toBeNull();
  });

  it("rolls back BOTH writes when the supersede step fails mid-transaction", async () => {
    // Inject a db whose supersede UPDATE aborts, proving the new-fact insert is
    // rolled back too — the partial-update window the non-atomic code left open.
    const db = new DatabaseSync(":memory:");
    const injectedStore = new SqliteMemoryStore({ db, now: () => NOW });

    const scope = SCOPE_A;
    const oldFact = makeFact({ scope, text: "old preference" });
    await injectedStore.upsertFact(oldFact);

    // newFact.id is the sentinel the trigger watches: superseding the old fact
    // writes superseded_by = 'BOOM', which raises and aborts the transaction.
    const newFact = makeFact({ scope, id: "BOOM", text: "new preference" });
    db.exec(
      `CREATE TRIGGER block_boom BEFORE UPDATE ON facts
       WHEN NEW.superseded_by = 'BOOM'
       BEGIN
         SELECT RAISE(ABORT, 'boom');
       END;`,
    );

    await expect(
      injectedStore.replaceFact(oldFact.id, newFact),
    ).rejects.toThrow();

    // The new fact insert was rolled back, and the old fact stays untouched.
    expect(await injectedStore.getFact("BOOM")).toBeNull();
    const oldRow = await injectedStore.getFact(oldFact.id);
    expect(oldRow!.invalidAt).toBeNull();
    expect(oldRow!.supersededBy).toBeNull();

    injectedStore.close();
  });
});

// ---------------------------------------------------------------------------
// Ordering: recency + importance (no queryEmbedding, large budget)
// ---------------------------------------------------------------------------

describe("ordering", () => {
  it("higher importance outranks lower importance at equal createdAt", async () => {
    const scope = SCOPE_A;
    const store2 = new SqliteMemoryStore({ now: () => NOW });

    const low = makeFact({ scope, importance: 0.1, createdAt: NOW });
    const high = makeFact({ scope, importance: 0.9, createdAt: NOW });

    await store2.upsertFact(low);
    await store2.upsertFact(high);

    const results = await store2.retrieve({
      scope,
      budgetTokens: 999999,
      now: NOW,
    });

    store2.close();

    const ids = results.map((f) => f.id);
    expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low.id));
  });

  it("more recent fact outranks older fact at equal importance", async () => {
    const scope = SCOPE_A;
    const store3 = new SqliteMemoryStore({ now: () => NOW });

    const older = makeFact({
      scope,
      importance: 0.5,
      createdAt: NOW - 1_000_000,
    });
    const newer = makeFact({ scope, importance: 0.5, createdAt: NOW });

    await store3.upsertFact(older);
    await store3.upsertFact(newer);

    const results = await store3.retrieve({
      scope,
      budgetTokens: 999999,
      now: NOW,
    });

    store3.close();

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

    // Each text is exactly 8 chars → estimateTokens = 2.
    const facts = Array.from({ length: 5 }, (_, i) =>
      makeFact({
        scope,
        text: `12345678${i}`.slice(0, 8),
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

    // bigFact: high importance (top-scored) but text is 40 chars → 10 tokens.
    const bigText = "a".repeat(40); // estimateTokens = 10
    const bigFact = makeFact({
      scope,
      text: bigText,
      importance: 1.0,
      createdAt: NOW,
    });

    // smallFact: lower importance (lower-scored) but text is 4 chars → 1 token.
    const smallText = "abcd"; // estimateTokens = 1
    const smallFact = makeFact({
      scope,
      text: smallText,
      importance: 0.1,
      createdAt: NOW,
    });

    await store.upsertFact(bigFact);
    await store.upsertFact(smallFact);

    // Budget: 5 tokens. bigFact needs 10 (skipped). smallFact needs 1 (fits).
    const budgetTokens = 5;
    expect(estimateTokens(bigText)).toBeGreaterThan(budgetTokens); // precondition
    expect(estimateTokens(smallText)).toBeLessThanOrEqual(budgetTokens); // precondition

    const results = await store.retrieve({ scope, budgetTokens, now: NOW });

    const ids = results.map((f) => f.id);
    expect(ids).not.toContain(bigFact.id); // too large, skipped
    expect(ids).toContain(smallFact.id); // smaller, fits after skip
  });

  it("a single fact larger than the whole budget is excluded", async () => {
    const scope = SCOPE_A;

    // 100 chars → estimateTokens = 25
    const hugeText = "x".repeat(100);
    const hugeFact = makeFact({ scope, text: hugeText, importance: 1.0 });

    await store.upsertFact(hugeFact);

    const budgetTokens = 10; // 25 > 10, so it must be excluded
    expect(estimateTokens(hugeText)).toBeGreaterThan(budgetTokens); // precondition

    const results = await store.retrieve({ scope, budgetTokens, now: NOW });

    const ids = results.map((f) => f.id);
    expect(ids).not.toContain(hugeFact.id);
  });
});

// ---------------------------------------------------------------------------
// Relevance scoring with queryEmbedding
// ---------------------------------------------------------------------------

describe("relevance with queryEmbedding", () => {
  it("semantically-closer fact ranks first when relevance weight dominates", async () => {
    const scope = SCOPE_A;
    const embedder = createFakeEmbedder();

    // Two texts with very different token distributions so their embeddings
    // are well-separated in the fake embedding space.
    const textClose = "apple banana cherry";
    const textFar = "quantum physics nuclear reactor";

    const embeddingClose = await embedder.embed(textClose);
    const embeddingFar = await embedder.embed(textFar);

    // Query embedding is identical to "close" text's embedding.
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
    const result = await store.getRelationship(scopeA);
    expect(result).toBeNull();
  });

  it("putRelationship then getRelationship returns deep-equal state (including flags)", async () => {
    await store.putRelationship(stateA);
    const result = await store.getRelationship(scopeA);
    expect(result).toEqual(stateA);
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

    const resultB = await store.getRelationship(scopeB);
    expect(resultB).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Session round-trip + idempotency (verified via injected DB handle)
// ---------------------------------------------------------------------------

describe("session round-trip and idempotency", () => {
  it("saveSession twice with same id produces exactly one row; second call's summary wins", async () => {
    // Inject the db handle so we can query it directly.
    const db = new DatabaseSync(":memory:");
    const injectedStore = new SqliteMemoryStore({ db, now: () => NOW });

    const sessionId = crypto.randomUUID();
    const scope: MemoryScope = { userId: "userA", characterId: "charA" };

    const rec1: SessionRecord = {
      id: sessionId,
      scope,
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

    await injectedStore.saveSession(rec1);
    await injectedStore.saveSession(rec2);

    // Verify exactly one row (no duplicates).
    const countRow = db
      .prepare("SELECT COUNT(*) AS c FROM sessions WHERE id = ?")
      .get(sessionId) as { c: number };
    expect(countRow.c).toBe(1);

    // Verify the second call's summary is persisted.
    const summaryRow = db
      .prepare("SELECT summary FROM sessions WHERE id = ?")
      .get(sessionId) as { summary: string };
    expect(summaryRow.summary).toBe("updated summary");

    injectedStore.close();
  });
});

// ---------------------------------------------------------------------------
// Finalization ledger
// ---------------------------------------------------------------------------

describe("finalization ledger", () => {
  // A tiny transcript with one positive user turn — drives deriveRelationshipSignals.
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

  function saveSessionRec(
    s: SqliteMemoryStore,
    id: string,
    scope: MemoryScope,
  ): Promise<void> {
    const rec: SessionRecord = {
      id,
      scope,
      startedAt: NOW - 1000,
      endedAt: NOW,
      summary: null,
      turnCount: 1,
    };
    return s.saveSession(rec);
  }

  it("saved session: isSessionFinalized false → finalizeSession true → finalized true and relationship reduced", async () => {
    const id = "sess-1";
    await saveSessionRec(store, id, SCOPE_A);

    expect(await store.isSessionFinalized(id)).toBe(false);

    const signals = deriveRelationshipSignals(makeTranscript(id, SCOPE_A));
    const result = await store.finalizeSession(
      SCOPE_A,
      id,
      signals,
      NOW,
      updateRelationship,
    );
    expect(result).toBe(true);
    expect(await store.isSessionFinalized(id)).toBe(true);

    const rel = await store.getRelationship(SCOPE_A);
    expect(rel?.sessionCount).toBe(1);
    expect(rel?.lastSeenAt).toBe(NOW);
  });

  it("[B7] second finalizeSession for same id returns false, relationship unchanged, finalized_at keeps its first value", async () => {
    const db = new DatabaseSync(":memory:");
    const injectedStore = new SqliteMemoryStore({ db, now: () => NOW });

    const id = "sess-b7";
    await saveSessionRec(injectedStore, id, SCOPE_A);

    const signals = deriveRelationshipSignals(makeTranscript(id, SCOPE_A));

    const FIRST_T = NOW;
    const first = await injectedStore.finalizeSession(
      SCOPE_A,
      id,
      signals,
      FIRST_T,
      updateRelationship,
    );
    expect(first).toBe(true);

    const firstMarker = db
      .prepare("SELECT finalized_at FROM sessions WHERE id = ?")
      .get(id) as { finalized_at: number };
    expect(firstMarker.finalized_at).toBe(FIRST_T);

    // Second finalize with a DIFFERENT timestamp must be rejected.
    const SECOND_T = NOW + 5000;
    const second = await injectedStore.finalizeSession(
      SCOPE_A,
      id,
      signals,
      SECOND_T,
      updateRelationship,
    );
    expect(second).toBe(false);

    const rel = await injectedStore.getRelationship(SCOPE_A);
    expect(rel?.sessionCount).toBe(1); // not advanced a second time

    const secondMarker = db
      .prepare("SELECT finalized_at FROM sessions WHERE id = ?")
      .get(id) as { finalized_at: number };
    expect(secondMarker.finalized_at).toBe(FIRST_T); // marker unchanged

    injectedStore.close();
  });

  it("[m8] finalizeSession on a never-saved session returns false and leaves the relationship unchanged", async () => {
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

  it("[M13]+[m9] two sessions for the same scope each finalize once; sessionCount reaches 2 with no lost increment", async () => {
    const s1 = "sess-c1";
    const s2 = "sess-c2";
    await saveSessionRec(store, s1, SCOPE_A);
    await saveSessionRec(store, s2, SCOPE_A);

    const signals: RelationshipSignals = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 0,
    };

    const r1 = await store.finalizeSession(
      SCOPE_A,
      s1,
      signals,
      NOW,
      updateRelationship,
    );
    const r2 = await store.finalizeSession(
      SCOPE_A,
      s2,
      signals,
      NOW,
      updateRelationship,
    );
    expect(r1).toBe(true);
    expect(r2).toBe(true);

    const rel = await store.getRelationship(SCOPE_A);
    expect(rel?.sessionCount).toBe(2);
  });

  it("[B5] a saveSession upsert after finalize (delayed checkpoint) leaves the session finalized", async () => {
    const id = "sess-b5";
    await saveSessionRec(store, id, SCOPE_A);

    const signals: RelationshipSignals = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 0,
    };
    await store.finalizeSession(SCOPE_A, id, signals, NOW, updateRelationship);
    expect(await store.isSessionFinalized(id)).toBe(true);

    // A delayed checkpoint writes endedAt: null (and never touches finalized_at).
    await store.saveSession({
      id,
      scope: SCOPE_A,
      startedAt: NOW - 1000,
      endedAt: null,
      summary: null,
      turnCount: 2,
    });

    expect(await store.isSessionFinalized(id)).toBe(true);
  });

  it("[m6]+[M12] migration: opening a subtask-02 DB without finalized_at adds the column and the ledger works end-to-end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "charivo-ledger-"));
    const dbPath = join(dir, "memory.db");

    try {
      // Pre-create the subtask-02 sessions shape (NO finalized_at column).
      const raw = new DatabaseSync(dbPath);
      raw.exec(
        `CREATE TABLE sessions (
           id TEXT PRIMARY KEY,
           user_id TEXT NOT NULL,
           character_id TEXT NOT NULL,
           started_at INTEGER NOT NULL,
           ended_at INTEGER,
           summary TEXT,
           turn_count INTEGER NOT NULL
         )`,
      );
      raw.close();

      // Open the SAME file through the store — migrate() must add the column.
      const migratedStore = new SqliteMemoryStore({
        db: dbPath,
        now: () => NOW,
      });

      // (a) column now exists (verified on a fresh raw handle).
      const checkHandle = new DatabaseSync(dbPath);
      const cols = checkHandle
        .prepare("PRAGMA table_info(sessions)")
        .all() as Array<{ name: string }>;
      checkHandle.close();
      expect(cols.some((c) => c.name === "finalized_at")).toBe(true);

      // (b) the ledger runs end-to-end without throwing.
      const id = "sess-migrated";
      await saveSessionRec(migratedStore, id, SCOPE_A);
      expect(await migratedStore.isSessionFinalized(id)).toBe(false);

      const signals: RelationshipSignals = {
        userTurnCount: 1,
        positiveSignals: 0,
        negativeSignals: 0,
      };
      const advanced = await migratedStore.finalizeSession(
        SCOPE_A,
        id,
        signals,
        NOW,
        updateRelationship,
      );
      expect(advanced).toBe(true);
      expect(await migratedStore.isSessionFinalized(id)).toBe(true);

      migratedStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
