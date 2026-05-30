import type {
  MemoryFact,
  MemoryQuery,
  MemoryScope,
  RelationshipState,
} from "./types";
import {
  MEMORY_TOKEN_BUDGET,
  MAX_SUMMARIES,
  selectMemoryForRender,
  renderMemoryBlock,
  renderRelationshipBlock,
} from "./render-memory";
import { composeInstructions } from "../app/lib/compose-instructions";

// Module-local structural type — NOT exported from the barrel.
interface MemoryReadStore {
  retrieve(query: MemoryQuery): Promise<MemoryFact[]>;
  getRecentSummaries(
    scope: MemoryScope,
    limit: number,
  ): Promise<{ id: string; endedAt: number | null; summary: string }[]>;
  getRelationship(scope: MemoryScope): Promise<RelationshipState | null>;
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

  const rel = await args.store.getRelationship(args.scope);

  const sel = selectMemoryForRender({
    facts,
    summaries: recent.map((r) => r.summary),
  });

  return composeInstructions([
    renderMemoryBlock(sel.facts, sel.summaries),
    renderRelationshipBlock(rel),
  ]);
}
