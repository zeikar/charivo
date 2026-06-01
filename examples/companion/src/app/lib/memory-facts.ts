// Thin async adapter over the client memory store so UI panels never touch
// store internals or the full MemoryFact shape. These functions do NOT swallow
// errors: they await the store and let failures propagate. The caller (the
// settings panel) is responsible for try/catch + console.warn.

import { getClientMemoryStore } from "@/memory/client-store";
import { createFakeEmbedder } from "@/memory/embedding";
import type { MemoryFact, MemoryScope } from "@/memory/types";

/** A memory fact reduced to just what the settings UI renders. */
export type MemoryFactView = { id: string; text: string; kind: string };

/** List the active facts for the given scope, reduced to the UI view. */
export async function listFacts(scope: MemoryScope): Promise<MemoryFactView[]> {
  const store = getClientMemoryStore();
  const facts = await store.retrieve({
    scope,
    budgetTokens: Number.MAX_SAFE_INTEGER,
    now: Date.now(),
  });
  return facts.map((f) => ({ id: f.id, text: f.text, kind: f.kind }));
}

/** Add a user-taught fact. Trims input; an empty value is a no-op (no throw). */
export async function addFact(scope: MemoryScope, text: string): Promise<void> {
  const trimmed = text.trim();
  if (trimmed === "") return;

  const now = Date.now();
  const fact: MemoryFact = {
    id: `user_${crypto.randomUUID()}`,
    scope,
    text: trimmed,
    kind: "other",
    embedding: await createFakeEmbedder().embed(trimmed),
    importance: 0.6,
    sourceSessionId: null,
    sourceTurnId: null,
    createdAt: now,
    validAt: now,
    invalidAt: null,
    supersededBy: null,
  };

  await getClientMemoryStore().upsertFact(fact);
}

/** Retire a fact so it no longer surfaces in retrieval. */
export async function deleteFact(id: string): Promise<void> {
  await getClientMemoryStore().invalidate(id);
}
