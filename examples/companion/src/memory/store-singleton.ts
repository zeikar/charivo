import { SqliteMemoryStore } from "./sqlite-memory-store";
import { getCompanionDbPath } from "./db-path";

/**
 * Process-wide singleton over the file-backed memory store. The read
 * (`/api/memory`) and write (`/api/memory/promote`) routes share ONE connection
 * so a promotion write is immediately visible to the next retrieval and the two
 * routes never compete as separate open handles on the same SQLite file.
 *
 * Server-only: imports node:sqlite (via SqliteMemoryStore). Never import this
 * from a "use client" module.
 */
let store: SqliteMemoryStore | null = null;

export function getCompanionStore(): SqliteMemoryStore {
  if (!store) {
    store = new SqliteMemoryStore({ db: getCompanionDbPath() });
  }
  return store;
}
