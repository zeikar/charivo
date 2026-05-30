import { DatabaseSync } from "node:sqlite";

import { scoreFact, estimateTokens } from "./scoring";
import type {
  MemoryFact,
  MemoryFactKind,
  MemoryQuery,
  MemoryScope,
  MemoryStore,
  RelationshipState,
  SessionRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Row shapes returned by SQLite (all columns are primitives or null)
// ---------------------------------------------------------------------------

interface FactRow {
  id: string;
  user_id: string;
  character_id: string;
  text: string;
  kind: string;
  embedding: string;
  importance: number;
  source_session_id: string | null;
  source_turn_id: string | null;
  created_at: number;
  valid_at: number;
  invalid_at: number | null;
  superseded_by: string | null;
}

interface RelationshipRow {
  user_id: string;
  character_id: string;
  rapport: number;
  session_count: number;
  last_seen_at: number;
  address_style: string;
  flags: string;
}

// ---------------------------------------------------------------------------
// Deserializers
// ---------------------------------------------------------------------------

function rowToFact(row: FactRow): MemoryFact {
  return {
    id: row.id,
    scope: { userId: row.user_id, characterId: row.character_id },
    text: row.text,
    kind: row.kind as MemoryFactKind,
    embedding: JSON.parse(row.embedding) as number[],
    importance: row.importance,
    sourceSessionId: row.source_session_id,
    sourceTurnId: row.source_turn_id,
    createdAt: row.created_at,
    validAt: row.valid_at,
    invalidAt: row.invalid_at,
    supersededBy: row.superseded_by,
  };
}

function rowToRelationship(row: RelationshipRow): RelationshipState {
  return {
    scope: { userId: row.user_id, characterId: row.character_id },
    rapport: row.rapport,
    sessionCount: row.session_count,
    lastSeenAt: row.last_seen_at,
    addressStyle: row.address_style as RelationshipState["addressStyle"],
    flags: JSON.parse(row.flags) as Record<string, boolean>,
  };
}

// ---------------------------------------------------------------------------
// SqliteMemoryStore
// ---------------------------------------------------------------------------

export class SqliteMemoryStore implements MemoryStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(opts: { db?: DatabaseSync | string; now?: () => number } = {}) {
    if (opts.db instanceof DatabaseSync) {
      this.db = opts.db;
    } else {
      this.db = new DatabaseSync(
        typeof opts.db === "string" ? opts.db : ":memory:",
      );
    }
    this.now = opts.now ?? Date.now.bind(Date);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL,
        character_id     TEXT NOT NULL,
        text             TEXT NOT NULL,
        kind             TEXT NOT NULL,
        embedding        TEXT NOT NULL,
        importance       REAL NOT NULL,
        source_session_id TEXT,
        source_turn_id   TEXT,
        created_at       INTEGER NOT NULL,
        valid_at         INTEGER NOT NULL,
        invalid_at       INTEGER,
        superseded_by    TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_facts_scope
        ON facts (user_id, character_id);

      CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        character_id TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        summary      TEXT,
        turn_count   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relationship (
        user_id       TEXT NOT NULL,
        character_id  TEXT NOT NULL,
        rapport       REAL NOT NULL,
        session_count INTEGER NOT NULL,
        last_seen_at  INTEGER NOT NULL,
        address_style TEXT NOT NULL,
        flags         TEXT NOT NULL,
        PRIMARY KEY (user_id, character_id)
      );
    `);
  }

  async upsertFact(fact: MemoryFact): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO facts
           (id, user_id, character_id, text, kind, embedding, importance,
            source_session_id, source_turn_id, created_at, valid_at,
            invalid_at, superseded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id           = excluded.user_id,
           character_id      = excluded.character_id,
           text              = excluded.text,
           kind              = excluded.kind,
           embedding         = excluded.embedding,
           importance        = excluded.importance,
           source_session_id = excluded.source_session_id,
           source_turn_id    = excluded.source_turn_id,
           created_at        = excluded.created_at,
           valid_at          = excluded.valid_at,
           invalid_at        = excluded.invalid_at,
           superseded_by     = excluded.superseded_by`,
      )
      .run(
        fact.id,
        fact.scope.userId,
        fact.scope.characterId,
        fact.text,
        fact.kind,
        JSON.stringify(fact.embedding),
        fact.importance,
        fact.sourceSessionId,
        fact.sourceTurnId,
        fact.createdAt,
        fact.validAt,
        fact.invalidAt,
        fact.supersededBy,
      );
  }

  async getFact(id: string): Promise<MemoryFact | null> {
    const row = this.db.prepare(`SELECT * FROM facts WHERE id = ?`).get(id) as
      | FactRow
      | undefined;
    return row ? rowToFact(row) : null;
  }

  async retrieve(query: MemoryQuery): Promise<MemoryFact[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM facts
         WHERE user_id = ? AND character_id = ? AND invalid_at IS NULL`,
      )
      .all(query.scope.userId, query.scope.characterId) as unknown as FactRow[];

    const facts = rows.map(rowToFact);

    // Resolve reference timestamp once for consistent scoring.
    const now = query.now ?? this.now();

    // Score all facts.
    const scored = facts.map((fact) => ({
      fact,
      score: scoreFact(fact, {
        now,
        queryEmbedding: query.queryEmbedding,
        weights: query.weights,
      }),
    }));

    // Sort: score desc, stable tiebreak createdAt desc then id.
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
      // If tokens > remaining, skip this fact and continue to the next.
    }

    return selected;
  }

  async supersede(id: string, by: string | null): Promise<void> {
    // Sets BOTH invalid_at AND superseded_by (by may be null).
    this.db
      .prepare(
        `UPDATE facts SET invalid_at = ?, superseded_by = ? WHERE id = ?`,
      )
      .run(this.now(), by, id);
  }

  async invalidate(id: string): Promise<void> {
    this.db
      .prepare(`UPDATE facts SET invalid_at = ? WHERE id = ?`)
      .run(this.now(), id);
  }

  async saveSession(rec: SessionRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, character_id, started_at, ended_at, summary, turn_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id      = excluded.user_id,
           character_id = excluded.character_id,
           started_at   = excluded.started_at,
           ended_at     = excluded.ended_at,
           summary      = excluded.summary,
           turn_count   = excluded.turn_count`,
      )
      .run(
        rec.id,
        rec.scope.userId,
        rec.scope.characterId,
        rec.startedAt,
        rec.endedAt,
        rec.summary,
        rec.turnCount,
      );
  }

  async getRelationship(scope: MemoryScope): Promise<RelationshipState | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM relationship WHERE user_id = ? AND character_id = ?`,
      )
      .get(scope.userId, scope.characterId) as RelationshipRow | undefined;
    return row ? rowToRelationship(row) : null;
  }

  async putRelationship(state: RelationshipState): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO relationship
           (user_id, character_id, rapport, session_count, last_seen_at,
            address_style, flags)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, character_id) DO UPDATE SET
           rapport       = excluded.rapport,
           session_count = excluded.session_count,
           last_seen_at  = excluded.last_seen_at,
           address_style = excluded.address_style,
           flags         = excluded.flags`,
      )
      .run(
        state.scope.userId,
        state.scope.characterId,
        state.rapport,
        state.sessionCount,
        state.lastSeenAt,
        state.addressStyle,
        JSON.stringify(state.flags),
      );
  }

  /** Close the underlying database. Intended for test teardown. */
  close(): void {
    this.db.close();
  }
}
