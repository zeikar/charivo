import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { SqliteMemoryStore } from "./sqlite-memory-store";
import { createFakeEmbedder } from "./embedding";
import { estimateTokens } from "./scoring";
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
