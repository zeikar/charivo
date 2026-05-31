import { LocalStorageMemoryStore } from "./local-storage-memory-store";

/**
 * Browser-only memory store shared by the read (inject) and write (promote)
 * paths. localStorage is itself the shared persistence, but a single instance
 * avoids redundant construction. Constructed lazily so it is only touched in a
 * client context (never during SSR), where `globalThis.localStorage` exists.
 */
let store: LocalStorageMemoryStore | null = null;

export function getClientMemoryStore(): LocalStorageMemoryStore {
  if (!store) store = new LocalStorageMemoryStore();
  return store;
}
