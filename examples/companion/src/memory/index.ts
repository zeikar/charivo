export type {
  MemoryScope,
  MemoryFactKind,
  MemoryFact,
  SessionRecord,
  RelationshipState,
  MemoryQuery,
  EmbeddingAdapter,
  MemoryStore,
} from "./types";

export { createFakeEmbedder } from "./embedding";

export { SqliteMemoryStore } from "./sqlite-memory-store";

export {
  cosineSimilarity,
  recencyDecay,
  estimateTokens,
  scoreFact,
} from "./scoring";

export { promoteSession } from "./promote";
export { createWriteJobScheduler } from "./trigger";
export { extractFacts } from "./extract-facts";
export { policyFilter } from "./policy-filter";
export { decideMerge } from "./decide-merge";
export { updateRelationship, deriveRelationshipSignals } from "./relationship";

export type {
  Turn,
  Transcript,
  FactCandidate,
  FactExtractor,
  ExtractResult,
  MergeAction,
  MergeDecision,
  RelationshipSignals,
  PromotionResult,
} from "./promotion-types";
