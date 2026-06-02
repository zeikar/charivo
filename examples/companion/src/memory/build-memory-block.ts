import type { MemoryFact, MemoryQuery, MemoryScope } from "./types";
import {
  MEMORY_TOKEN_BUDGET,
  MAX_SUMMARIES,
  selectMemoryForRender,
  renderMemoryBlock,
} from "./render-memory";

// Module-local structural type — NOT exported from the barrel.
interface MemoryReadStore {
  retrieve(query: MemoryQuery): Promise<MemoryFact[]>;
  getRecentSummaries(
    scope: MemoryScope,
    limit: number,
  ): Promise<{ id: string; endedAt: number | null; summary: string }[]>;
}

export async function buildMemoryInstructionBlock(args: {
  store: MemoryReadStore;
  scope: MemoryScope;
  now: number;
  queryEmbedding?: number[];
}): Promise<string> {
  const facts = await args.store.retrieve({
    scope: args.scope,
    budgetTokens: MEMORY_TOKEN_BUDGET,
    now: args.now,
    queryEmbedding: args.queryEmbedding,
  });

  const recent = await args.store.getRecentSummaries(args.scope, MAX_SUMMARIES);

  const sel = selectMemoryForRender({
    facts,
    summaries: recent.map((r) => r.summary),
  });

  return renderMemoryBlock(sel.facts, sel.summaries);
}
