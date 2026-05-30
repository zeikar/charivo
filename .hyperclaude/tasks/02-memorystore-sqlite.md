# 02 — `MemoryStore` interface + SQLite + in-memory vector (mechanism only)

**Depends on:** 01. **Run:** `/hyperclaude:hyper-auto` with the prompt below.

## Goal

Define the **extraction-ready memory mechanism** and a working server-side
store. Pure storage + retrieval primitives, deterministically unit-tested. No
extraction, no policy, no instructions wiring yet — this is the generic layer
that later graduates to `@charivo/memory`.

## In scope

- **Types** (scope on every record): `MemoryScope = { userId, characterId }`,
  `MemoryFact`, `SessionRecord`, `RelationshipState`.
  - `MemoryFact`: `id`, scope, `text`, `kind` (`preference|biographical|event|other`),
    `embedding`, `importance` (0..1), `sourceSessionId`, `sourceTurnId`,
    `createdAt`, `validAt`, `invalidAt | null`, `supersededBy | null`.
  - `SessionRecord`: `id`, scope, `startedAt`, `endedAt`, `transcript: Turn[]`,
    `summary`, `extractedFactIds: string[]`.
  - `RelationshipState` (typed): scope, `rapport` (0..1), `sessionCount`,
    `lastSeenAt`, `addressStyle` (`formal|casual`), `flags: Record<string,boolean>`.
- **`MemoryStore` interface (mechanism only):**
  ```ts
  interface MemoryStore {
    saveSession(rec: SessionRecord): Promise<void>;
    upsertFact(fact: MemoryFact): Promise<void>;
    retrieve(q: RetrieveQuery): Promise<MemoryFact[]>; // active only (invalidAt == null)
    supersede(id: string, by: string | null): Promise<void>;
    invalidate(id: string): Promise<void>;
    getRelationship(scope: MemoryScope): Promise<RelationshipState | null>;
    putRelationship(state: RelationshipState): Promise<void>;
  }
  // RetrieveQuery: { scope, queryEmbedding?, budgetTokens, weights?: {recency, importance, relevance} }
  ```
- **SQLite-backed impl** (server-side) + **in-memory cosine** retrieval. Score =
  recency-decay + importance (+ relevance when `queryEmbedding` given). Enforce
  `budgetTokens` cap and scope filtering.
- **Embedding adapter interface** (pluggable); a deterministic fake embedder for
  tests.
- **Unit tests** (deterministic, fake embedder): scope isolation (no cross-scope
  leak), superseded/invalidated facts excluded from `retrieve`, recency+importance
  ordering, budget cap respected.

## Out of scope

- Extraction, promotion, merge logic, instructions injection, voice deletion,
  any LLM call, Postgres. (Keep the boundary clean so Postgres+pgvector is a
  later drop-in behind `MemoryStore`.)

## Verify

- Unit tests pass deterministically (no live LLM/embeddings).
- `pnpm verify` green.

## hyper-auto prompt

> Implement the memory mechanism per
> `.hyperclaude/tasks/02-memorystore-sqlite.md`: the `MemoryStore` interface and
> types (scope = `userId + characterId`), a server-side SQLite implementation
> with in-memory cosine retrieval (recency + importance, optional relevance), a
> pluggable embedding adapter with a deterministic fake for tests, and unit
> tests for scope isolation, supersede/invalidate exclusion, ordering, and
> budget cap. Mechanism only — no extraction/policy/injection. Honor all fixed
> constraints in `.hyperclaude/tasks/README.md`. Verify with `pnpm verify`.
