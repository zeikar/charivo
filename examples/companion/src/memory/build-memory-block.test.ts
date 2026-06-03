import { describe, it, expect, beforeEach } from "vitest";

import { buildMemoryInstructionBlock } from "./build-memory-block";
import { MEMORY_GUARD_LINE } from "./render-memory";
import {
  LocalStorageMemoryStore,
  createInMemoryStorage,
} from "./local-storage-memory-store";
import { createFakeEmbedder } from "./embedding";
import { composeInstructions } from "../app/lib/compose-instructions";
import type {
  MemoryFact,
  MemoryQuery,
  MemoryScope,
  SessionRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Fixed clock
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Scope + fact factory
// ---------------------------------------------------------------------------

const SCOPE: MemoryScope = { userId: "userX", characterId: "charX" };

function makeFact(
  overrides: Partial<MemoryFact> & { scope?: MemoryScope } = {},
): MemoryFact {
  return {
    id: crypto.randomUUID(),
    scope: SCOPE,
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
// MemoryReadStore structural interface (mirrors the module-local type in build-memory-block.ts)
// ---------------------------------------------------------------------------

interface MemoryReadStore {
  retrieve(query: MemoryQuery): Promise<MemoryFact[]>;
  getRecentSummaries(
    scope: MemoryScope,
    limit: number,
  ): Promise<{ id: string; endedAt: number | null; summary: string }[]>;
}

// ---------------------------------------------------------------------------
// Cold-start (real store)
// ---------------------------------------------------------------------------

describe("buildMemoryInstructionBlock — cold-start (real store)", () => {
  let store: LocalStorageMemoryStore;

  beforeEach(() => {
    store = new LocalStorageMemoryStore({
      storage: createInMemoryStorage(),
      now: () => NOW,
    });
  });

  it("returns non-empty result and contains MEMORY_GUARD_LINE after seeding facts", async () => {
    const embedder = createFakeEmbedder();
    const text = "user loves jazz music";
    const embedding = await embedder.embed(text);

    const fact = makeFact({ text, embedding, importance: 0.9 });
    await store.upsertFact(fact);

    const result = await buildMemoryInstructionBlock({
      store,
      scope: SCOPE,
      now: NOW,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain(MEMORY_GUARD_LINE);
  });

  it("contains the highest-ranked seeded fact's text in the result", async () => {
    const embedder = createFakeEmbedder();

    const highText = "user is an avid reader";
    const lowText = "user prefers tea over coffee";

    const highFact = makeFact({
      text: highText,
      embedding: await embedder.embed(highText),
      importance: 1.0,
      createdAt: NOW,
    });
    const lowFact = makeFact({
      text: lowText,
      embedding: await embedder.embed(lowText),
      importance: 0.1,
      createdAt: NOW,
    });

    await store.upsertFact(highFact);
    await store.upsertFact(lowFact);

    const result = await buildMemoryInstructionBlock({
      store,
      scope: SCOPE,
      now: NOW,
    });

    // The highest-ranked fact (by importance) must appear in the result.
    expect(result).toContain(highText);
  });

  it("composeInstructions includes the memory block verbatim", async () => {
    const embedder = createFakeEmbedder();
    const text = "user enjoys painting";
    const embedding = await embedder.embed(text);

    await store.upsertFact(makeFact({ text, embedding, importance: 0.8 }));

    const block = await buildMemoryInstructionBlock({
      store,
      scope: SCOPE,
      now: NOW,
    });

    const composed = composeInstructions([
      "You are a helpful companion.",
      "Be friendly.",
      block,
    ]);

    expect(composed).toContain(block);
  });

  it("saveSession with non-null summary causes the session summary to appear in the block", async () => {
    const embedder = createFakeEmbedder();
    const factText = "user works as an engineer";
    await store.upsertFact(
      makeFact({ text: factText, embedding: await embedder.embed(factText) }),
    );

    const session: SessionRecord = {
      id: crypto.randomUUID(),
      scope: SCOPE,
      startedAt: NOW - 10_000,
      endedAt: NOW - 1_000,
      summary: "We discussed the user's career in engineering.",
      turnCount: 4,
    };
    await store.saveSession(session);

    const result = await buildMemoryInstructionBlock({
      store,
      scope: SCOPE,
      now: NOW,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain(MEMORY_GUARD_LINE);
  });
});

// ---------------------------------------------------------------------------
// Refresh — spy proves the relevance path ran
// ---------------------------------------------------------------------------

describe("buildMemoryInstructionBlock — refresh spy (queryEmbedding threading)", () => {
  it("cold-start passes undefined queryEmbedding; refresh passes the provided embedding", async () => {
    const embedder = createFakeEmbedder();

    const cannedFact1 = makeFact({ text: "user likes hiking", embedding: [] });
    const cannedFact2 = makeFact({
      text: "user dislikes crowds",
      embedding: [],
    });

    // Capture all queryEmbedding values received by retrieve().
    const capturedQueryEmbeddings: Array<number[] | undefined> = [];

    const spy: MemoryReadStore = {
      retrieve(query: MemoryQuery): Promise<MemoryFact[]> {
        capturedQueryEmbeddings.push(query.queryEmbedding);
        return Promise.resolve([cannedFact1, cannedFact2]);
      },
      getRecentSummaries(
        _scope: MemoryScope,
        _limit: number,
      ): Promise<{ id: string; endedAt: number | null; summary: string }[]> {
        return Promise.resolve([]);
      },
    };

    // First call: no queryEmbedding (cold-start)
    await buildMemoryInstructionBlock({ store: spy, scope: SCOPE, now: NOW });

    // Second call: with queryEmbedding (refresh)
    const queryEmbedding = await embedder.embed("I love hiking");
    await buildMemoryInstructionBlock({
      store: spy,
      scope: SCOPE,
      now: NOW,
      queryEmbedding,
    });

    expect(capturedQueryEmbeddings).toHaveLength(2);

    // Cold-start: queryEmbedding was not provided → undefined
    expect(capturedQueryEmbeddings[0]).toBeUndefined();

    // Refresh: queryEmbedding was provided and threaded through
    expect(capturedQueryEmbeddings[1]).toBeDefined();
    expect(capturedQueryEmbeddings[1]).toEqual(
      await embedder.embed("I love hiking"),
    );
  });
});

// ---------------------------------------------------------------------------
// Empty store
// ---------------------------------------------------------------------------

describe("buildMemoryInstructionBlock — empty store", () => {
  let store: LocalStorageMemoryStore;

  beforeEach(() => {
    store = new LocalStorageMemoryStore({
      storage: createInMemoryStorage(),
      now: () => NOW,
    });
  });

  it("returns empty string when store has no facts or summaries", async () => {
    const result = await buildMemoryInstructionBlock({
      store,
      scope: SCOPE,
      now: NOW,
    });
    expect(result).toBe("");
  });
});
