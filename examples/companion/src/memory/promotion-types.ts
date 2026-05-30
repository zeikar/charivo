/**
 * Pipeline I/O contracts for the memory promotion system.
 * The generic mechanism graduates to @charivo/memory later; product policy does not.
 */

import type { MemoryScope, MemoryFactKind, RelationshipState } from "./types";

/** A single utterance within a session. `id` is the citable `sourceTurnId`; `at` is epoch-ms. */
export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
};

/** The full conversation transcript for one session. */
export type Transcript = {
  sessionId: string;
  scope: MemoryScope;
  startedAt: number;
  endedAt: number | null;
  turns: Turn[];
};

/** A raw fact candidate produced by a `FactExtractor`. `sourceTurnId` is required as a hallucination filter. */
export type FactCandidate = {
  text: string;
  kind: MemoryFactKind;
  importance: number;
  /** Required, non-null: the `Turn.id` this candidate was derived from. */
  sourceTurnId: string;
  /**
   * Optional: the entity/slot this fact is about (e.g. "coffee", "job").
   * Supplied by the extractor — a real LLM would emit it; scripted fakes
   * provide it in fixtures. When present and non-empty, `decideMerge` uses it
   * as an anchor for the replacement check: a same-kind neighbor is considered
   * the target only when its text contains `subject` as a whole word.
   * Absent or empty → no auto-supersede (precision-first; prefer ADD over a
   * wrong UPDATE). Not persisted; used only during the promotion pass.
   */
  subject?: string;
};

/**
 * Extracts fact candidates from a conversation transcript.
 *
 * Real implementations may be an LLM call; tests pass a scripted fake.
 * The extractor MAY return candidates citing assistant turns — `extractFacts`
 * (not the extractor) owns the user-turn and evidence filtering.
 * Keying is by `sourceTurnId` only, not by session id.
 */
export interface FactExtractor {
  extract(transcript: Transcript): Promise<FactCandidate[]>;
}

/** The outcome of a single extraction pass. */
export type ExtractResult = {
  candidates: FactCandidate[];
  droppedCount: number;
};

/** The merge action to take for a single candidate against existing facts. */
export type MergeAction = "ADD" | "UPDATE" | "DELETE" | "NOOP";

/** The merge decision for a single candidate. `targetFactId` is the existing fact an UPDATE/DELETE acts on; null for ADD/NOOP. */
export type MergeDecision = {
  action: MergeAction;
  targetFactId: string | null;
};

/**
 * Deterministic signals derived from a transcript, used to advance relationship state.
 * These are NOT model-written; they are computed from observable turn data.
 */
export type RelationshipSignals = {
  userTurnCount: number;
  positiveSignals: number;
  negativeSignals: number;
  /** Hint derived from transcript content about the preferred address style. */
  addressStyleHint?: RelationshipState["addressStyle"];
};

/**
 * Aggregate result of a full promotion run.
 *
 * `dropped` = extraction drops (`ExtractResult.droppedCount`) PLUS policy rejects
 * (candidates the policyFilter admission gate rejected) — all candidates that never
 * reached merge.
 * `relationshipUpdated` is true only when this run actually advanced the relationship
 * (finalize + not-already-finalized).
 */
export type PromotionResult = {
  added: number;
  superseded: number;
  invalidated: number;
  noop: number;
  dropped: number;
  relationshipUpdated: boolean;
};
