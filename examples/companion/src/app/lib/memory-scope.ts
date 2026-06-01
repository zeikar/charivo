// Single source of truth for memory scope shape.
// `characterId` partitions memory per character so each companion has its own
// isolated memory namespace. `userId` is the fixed local-only placeholder —
// there is no auth; isolation is per-browser via localStorage.

import type { MemoryScope } from "@/memory/types";

export const MEMORY_USER_ID = "local-user";

export function makeMemoryScope(characterId: string): MemoryScope {
  return { userId: MEMORY_USER_ID, characterId };
}
