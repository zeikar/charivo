import { scoreFact, estimateTokens } from "./scoring";
import type { RelationshipSignals } from "./promotion-types";
import type {
  MemoryFact,
  MemoryQuery,
  MemoryScope,
  MemoryStore,
  RelationshipState,
  SessionRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Storage backend
//
// The browser persists memory entirely client-side in localStorage — no server
// DB, so the demo deploys to any static/serverless host and each browser gets
// its own isolated memory namespace (no shared multi-tenant state). The store
// is single-threaded (JS event loop), so the SQLite version's transactions
// collapse into plain read-modify-write: a "transaction" is just one
// synchronous load → mutate → save with no interleaving possible.
// ---------------------------------------------------------------------------

/** The slice of the Web Storage API this store needs (window.localStorage satisfies it). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage keys; one JSON document per collection. Exported as the storage contract. */
export const MEMORY_STORAGE_KEYS = {
  facts: "charivo:companion:facts",
  sessions: "charivo:companion:sessions",
  relationships: "charivo:companion:relationships",
} as const;

/** A Map-backed KeyValueStorage for tests / non-browser callers. */
export function createInMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

/** Session row plus the finalize-once ledger marker (kept out of SessionRecord). */
interface StoredSession {
  id: string;
  scope: MemoryScope;
  startedAt: number;
  endedAt: number | null;
  summary: string | null;
  turnCount: number;
  finalizedAt: number | null;
}

// Composite-key helpers — mirror the SQLite scoped PRIMARY KEY so a sessionId
// reused across scopes never collides. JSON-encoded so any delimiter inside a
// userId/characterId/id is escaped and can never forge a collision.
function sessionKey(scope: MemoryScope, id: string): string {
  return JSON.stringify([scope.userId, scope.characterId, id]);
}

function relKey(scope: MemoryScope): string {
  return JSON.stringify([scope.userId, scope.characterId]);
}

// ---------------------------------------------------------------------------
// LocalStorageMemoryStore
// ---------------------------------------------------------------------------

export class LocalStorageMemoryStore implements MemoryStore {
  private readonly storage: KeyValueStorage;
  private readonly now: () => number;

  constructor(opts: { storage?: KeyValueStorage; now?: () => number } = {}) {
    const fallback = (globalThis as { localStorage?: KeyValueStorage })
      .localStorage;
    const storage = opts.storage ?? fallback;
    if (!storage) {
      throw new Error(
        "LocalStorageMemoryStore requires a KeyValueStorage — no globalThis.localStorage is available (server context?). Inject one explicitly.",
      );
    }
    this.storage = storage;
    this.now = opts.now ?? Date.now.bind(Date);
  }

  // --- Collection load/save (one JSON document each) -----------------------

  private loadFacts(): Record<string, MemoryFact> {
    const raw = this.storage.getItem(MEMORY_STORAGE_KEYS.facts);
    return raw ? (JSON.parse(raw) as Record<string, MemoryFact>) : {};
  }
  private saveFacts(facts: Record<string, MemoryFact>): void {
    this.storage.setItem(MEMORY_STORAGE_KEYS.facts, JSON.stringify(facts));
  }
  private loadSessions(): Record<string, StoredSession> {
    const raw = this.storage.getItem(MEMORY_STORAGE_KEYS.sessions);
    return raw ? (JSON.parse(raw) as Record<string, StoredSession>) : {};
  }
  private saveSessions(sessions: Record<string, StoredSession>): void {
    this.storage.setItem(
      MEMORY_STORAGE_KEYS.sessions,
      JSON.stringify(sessions),
    );
  }
  private loadRelationships(): Record<string, RelationshipState> {
    const raw = this.storage.getItem(MEMORY_STORAGE_KEYS.relationships);
    return raw ? (JSON.parse(raw) as Record<string, RelationshipState>) : {};
  }
  private saveRelationships(rels: Record<string, RelationshipState>): void {
    this.storage.setItem(
      MEMORY_STORAGE_KEYS.relationships,
      JSON.stringify(rels),
    );
  }

  // --- Facts ---------------------------------------------------------------

  async upsertFact(fact: MemoryFact): Promise<void> {
    const facts = this.loadFacts();
    facts[fact.id] = fact;
    this.saveFacts(facts);
  }

  async getFact(id: string): Promise<MemoryFact | null> {
    return this.loadFacts()[id] ?? null;
  }

  async retrieve(query: MemoryQuery): Promise<MemoryFact[]> {
    const facts = Object.values(this.loadFacts()).filter(
      (f) =>
        f.scope.userId === query.scope.userId &&
        f.scope.characterId === query.scope.characterId &&
        f.invalidAt === null,
    );

    const now = query.now ?? this.now();

    const scored = facts.map((fact) => ({
      fact,
      score: scoreFact(fact, {
        now,
        queryEmbedding: query.queryEmbedding,
        weights: query.weights,
      }),
    }));

    // Sort: score desc, stable tiebreak createdAt desc then id desc.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.fact.createdAt !== a.fact.createdAt)
        return b.fact.createdAt - a.fact.createdAt;
      return b.fact.id < a.fact.id ? -1 : b.fact.id > a.fact.id ? 1 : 0;
    });

    // SKIP budget algorithm: include each fact that fits remaining budget;
    // skip (do not stop) facts that exceed it.
    let remaining = query.budgetTokens;
    const selected: MemoryFact[] = [];
    for (const { fact } of scored) {
      const tokens = estimateTokens(fact.text);
      if (tokens <= remaining) {
        selected.push(fact);
        remaining -= tokens;
      }
    }
    return selected;
  }

  async supersede(id: string, by: string | null): Promise<void> {
    const facts = this.loadFacts();
    const fact = facts[id];
    if (!fact) return; // no-op when absent, mirroring SQLite UPDATE ... WHERE id=?
    fact.invalidAt = this.now();
    fact.supersededBy = by;
    this.saveFacts(facts);
  }

  /**
   * Atomically replace a fact: write `newFact` AND supersede `oldId`, linking it
   * to `newFact.id`. Single synchronous load→mutate→save, so both land together.
   * Not part of MemoryStore (which stays mechanism-only); promoteSession needs it.
   */
  async replaceFact(oldId: string, newFact: MemoryFact): Promise<void> {
    const facts = this.loadFacts();
    facts[newFact.id] = newFact;
    const old = facts[oldId];
    if (old) {
      old.invalidAt = this.now();
      old.supersededBy = newFact.id;
    }
    this.saveFacts(facts);
  }

  async invalidate(id: string): Promise<void> {
    const facts = this.loadFacts();
    const fact = facts[id];
    if (!fact) return;
    fact.invalidAt = this.now(); // does NOT touch supersededBy, mirroring SQLite
    this.saveFacts(facts);
  }

  // --- Sessions ------------------------------------------------------------

  async saveSession(rec: SessionRecord): Promise<void> {
    const sessions = this.loadSessions();
    const key = sessionKey(rec.scope, rec.id);
    const existing = sessions[key];
    // Upsert the record fields but PRESERVE finalizedAt — a checkpoint write
    // must never clear the finalize-once ledger.
    sessions[key] = {
      id: rec.id,
      scope: rec.scope,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      summary: rec.summary,
      turnCount: rec.turnCount,
      finalizedAt: existing ? existing.finalizedAt : null,
    };
    this.saveSessions(sessions);
  }

  /**
   * Up to `limit` sessions with a non-blank summary, newest-first by
   * endedAt (falling back to startedAt). Mirrors SQLite getRecentSummaries.
   */
  async getRecentSummaries(
    scope: MemoryScope,
    limit: number,
  ): Promise<{ id: string; endedAt: number | null; summary: string }[]> {
    return Object.values(this.loadSessions())
      .filter(
        (s) =>
          s.scope.userId === scope.userId &&
          s.scope.characterId === scope.characterId &&
          s.summary !== null &&
          s.summary.trim() !== "",
      )
      .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
      .slice(0, limit)
      .map((s) => ({ id: s.id, endedAt: s.endedAt, summary: s.summary! }));
  }

  // --- Finalization ledger -------------------------------------------------

  async isSessionFinalized(scope: MemoryScope, id: string): Promise<boolean> {
    const s = this.loadSessions()[sessionKey(scope, id)];
    return s !== undefined && s.finalizedAt !== null;
  }

  /**
   * Finalize a session and advance its scope's relationship exactly once. JS is
   * single-threaded, so nothing can interleave between the two writes; the only
   * failure mode is a `setItem` throw (e.g. quota). The marker and relationship
   * live under separate keys, so a single write cannot cover both — instead, if
   * the relationship write fails AFTER the marker is persisted, the marker is
   * rolled back so a retry re-attempts the whole finalize. This preserves the
   * SQLite version's all-or-nothing guarantee: a session is never left
   * marker-finalized without its relationship advance. Returns true only when
   * this call advanced the relationship (session existed and was not already
   * finalized).
   */
  async finalizeSession(
    scope: MemoryScope,
    sessionId: string,
    signals: RelationshipSignals,
    now: number,
    reduce: (
      prev: RelationshipState | null,
      signals: RelationshipSignals,
      scope: MemoryScope,
      now: number,
    ) => RelationshipState,
  ): Promise<boolean> {
    const sessions = this.loadSessions();
    const session = sessions[sessionKey(scope, sessionId)];
    if (session === undefined) return false; // never saved / wrong scope
    if (session.finalizedAt !== null) return false; // already finalized

    // Compute the next relationship before any I/O so the two persists are
    // back-to-back with no logic between them.
    const rels = this.loadRelationships();
    const prev = rels[relKey(scope)] ?? null;
    rels[relKey(scope)] = reduce(prev, signals, scope, now);

    session.finalizedAt = now; // marker first (the guard)
    this.saveSessions(sessions);
    try {
      this.saveRelationships(rels);
    } catch (e) {
      // Relationship write failed → undo the marker so the next attempt can
      // complete the finalize instead of seeing a finalized-but-unadvanced row.
      session.finalizedAt = null;
      this.saveSessions(sessions);
      throw e;
    }
    return true;
  }

  // --- Relationship --------------------------------------------------------

  async getRelationship(scope: MemoryScope): Promise<RelationshipState | null> {
    return this.loadRelationships()[relKey(scope)] ?? null;
  }

  async putRelationship(state: RelationshipState): Promise<void> {
    const rels = this.loadRelationships();
    rels[relKey(state.scope)] = state;
    this.saveRelationships(rels);
  }
}
