/** Identifies the user+character pair that a memory record belongs to. */
export type MemoryScope = {
  userId: string;
  characterId: string;
};

/** The classification of a memory fact. */
export type MemoryFactKind = "preference" | "biographical" | "event" | "other";

/** A single persistent fact about the user, extracted from conversation. */
export interface MemoryFact {
  id: string;
  scope: MemoryScope;
  text: string;
  kind: MemoryFactKind;
  embedding: number[];
  /** 0..1 — higher means more worth keeping under token pressure. */
  importance: number;
  sourceSessionId: string | null;
  sourceTurnId: string | null;
  createdAt: number;
  validAt: number;
  /** Null while active; set to epoch-ms when the fact was retracted. */
  invalidAt: number | null;
  /** ID of the MemoryFact that replaces this one, or null. */
  supersededBy: string | null;
}

/** A record of one conversation session between the user and character. */
export interface SessionRecord {
  id: string;
  scope: MemoryScope;
  startedAt: number;
  endedAt: number | null;
  summary: string | null;
  turnCount: number;
}

/** Longitudinal relationship state between a user and a character. */
export interface RelationshipState {
  scope: MemoryScope;
  /** Running measure of positive/negative rapport; interpretation is caller-defined. */
  rapport: number;
  sessionCount: number;
  lastSeenAt: number;
  addressStyle: "formal" | "casual" | "unknown";
  /** Arbitrary boolean flags (e.g. "has_been_thanked", "declined_personal_questions"). */
  flags: Record<string, boolean>;
}

/** Parameters for a scored, token-budgeted retrieval of active memory facts. */
export interface MemoryQuery {
  scope: MemoryScope;
  /** Embedding of the current context; used for relevance scoring. */
  queryEmbedding?: number[];
  /** Maximum tokens the result set may consume (caller does accounting). */
  budgetTokens: number;
  weights?: {
    recency: number;
    importance: number;
    relevance: number;
  };
  /** Reference timestamp for recency scoring; defaults to Date.now() when omitted. */
  now?: number;
}

/** Produces a semantic embedding vector for a string. */
export interface EmbeddingAdapter {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

/**
 * Persistence contract for all memory-related data.
 * Implementations must live in a later task; this interface is mechanism-only.
 */
export interface MemoryStore {
  /** Insert or update a fact by id. */
  upsertFact(fact: MemoryFact): Promise<void>;

  /** Return the fact with the given id, or null if absent. */
  getFact(id: string): Promise<MemoryFact | null>;

  /**
   * Return active-only facts (invalidAt == null) for the given query scope,
   * scored by recency + importance + relevance, capped to budgetTokens.
   */
  retrieve(query: MemoryQuery): Promise<MemoryFact[]>;

  /**
   * Retire fact `id` (sets `invalidAt` so it is excluded from `retrieve`)
   * and record `by` as the id of the replacing fact, or null when there is
   * no specific replacement. Retiring is unconditional: passing null still
   * excludes the fact. `supersededBy` is only a replacement-link, never the
   * active gate.
   */
  supersede(id: string, by: string | null): Promise<void>;

  /** Set invalidAt on the fact, removing it from future retrieve results. */
  invalidate(id: string): Promise<void>;

  /** Idempotent upsert of a session record by id. */
  saveSession(rec: SessionRecord): Promise<void>;

  /** Return the relationship state for the given scope, or null if none exists. */
  getRelationship(scope: MemoryScope): Promise<RelationshipState | null>;

  /** Persist (create or overwrite) a relationship state. */
  putRelationship(state: RelationshipState): Promise<void>;
}
