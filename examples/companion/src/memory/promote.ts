/**
 * Promotion orchestrator: turns a finished (or checkpointed) session transcript
 * into durable memory — extracting facts, merging them against existing memory,
 * and (on finalize) advancing the longitudinal relationship state exactly once.
 *
 * Idempotency layers (a re-run with the same inputs is safe):
 *   1. Sessions:      saveSession is an id-keyed upsert.
 *   2. Facts:         each fact id is a deterministic structured hash ([M4]),
 *                     so upsertFact re-writes the same record instead of
 *                     duplicating it. A retraction re-run finds its target
 *                     already inactive → NOOP (decideMerge owns this).
 *   3. Relationship:  the dedicated finalize-once marker (read here, enforced
 *                     inside finalizeSession) gates the single relationship
 *                     advance per session.
 *
 * [M14] Concurrency assumption. finalizeSession advances the relationship
 * exactly once because JS is single-threaded within a tab: the marker write and
 * the relationship update run back-to-back with no interleaving, and a failed
 * relationship write rolls the marker back so a retry completes the advance. The
 * FACT path is correct only under the (unenforced) one-active-session-per-scope
 * assumption: two sessions promoting facts for the same scope concurrently (e.g.
 * two browser tabs sharing localStorage) could race on retrieve/merge. We do NOT
 * claim the fact path is concurrency-safe.
 */

import { extractFacts } from "./extract-facts";
import { policyFilter } from "./policy-filter";
import { decideMerge } from "./decide-merge";
import { deriveRelationshipSignals, updateRelationship } from "./relationship";
import type {
  Transcript,
  FactExtractor,
  RelationshipSignals,
  PromotionResult,
} from "./promotion-types";
import type {
  EmbeddingAdapter,
  MemoryFact,
  MemoryScope,
  MemoryStore,
} from "./types";

/**
 * The store contract promoteSession needs: the frozen MemoryStore interface
 * intersected with the two concrete ledger capabilities. LocalStorageMemoryStore
 * satisfies this; the MemoryStore interface itself stays untouched.
 */
type PromotionStore = MemoryStore & {
  isSessionFinalized(scope: MemoryScope, id: string): Promise<boolean>;
  replaceFact(oldId: string, newFact: MemoryFact): Promise<void>;
  finalizeSession(
    scope: MemoryScope,
    sessionId: string,
    signals: RelationshipSignals,
    now: number,
    reduce: typeof updateRelationship,
  ): Promise<boolean>;
};

/** Normalize text for the deterministic fact id (collapse whitespace, lowercase). */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Stable djb2-style hash of a string → unsigned hex. Mirrors the embedding
 * module's hash pattern. Deterministic (NOT crypto.randomUUID) so re-runs
 * produce the SAME id for the same candidate.
 */
function hashId(source: string): string {
  let h = 0;
  for (let i = 0; i < source.length; i++) {
    h = (Math.imul(h, 31) + source.charCodeAt(i)) | 0;
  }
  return `fact_${(h >>> 0).toString(16)}`;
}

export async function promoteSession(args: {
  transcript: Transcript;
  store: PromotionStore;
  embedder: EmbeddingAdapter;
  extractor: FactExtractor;
  now: number;
  finalize: boolean;
  topK?: number;
}): Promise<PromotionResult> {
  const { transcript, store, embedder, extractor, now, finalize } = args;
  const scope = transcript.scope;
  const topK = args.topK ?? 5;

  // 1. Read the dedicated finalization marker FIRST. The in-txn check inside
  //    finalizeSession remains authoritative; this is only a cheap early-out.
  const alreadyFinalized = await store.isSessionFinalized(
    scope,
    transcript.sessionId,
  );

  // 2. Idempotent session upsert. Does NOT touch finalized_at.
  //    summary is null: there is no LLM summarizer in the MVP (deferred).
  await store.saveSession({
    id: transcript.sessionId,
    scope,
    startedAt: transcript.startedAt,
    endedAt: transcript.endedAt,
    summary: null,
    turnCount: transcript.turns.length,
  });

  // 3. Extract raw fact candidates (extraction-level drops counted here).
  const { candidates, droppedCount } = await extractFacts(
    transcript,
    extractor,
  );

  // 4. Product-policy admission gate. `dropped` aggregates extraction drops
  //    PLUS policy rejects — every candidate that never reached merge.
  const allowed = candidates.filter(policyFilter);
  const dropped = droppedCount + (candidates.length - allowed.length);

  let added = 0;
  let superseded = 0;
  let invalidated = 0;
  let noop = 0;

  for (const candidate of allowed) {
    const emb = await embedder.embed(candidate.text);

    // Nearest active neighbors: relevance-only with a max budget so the store
    // ranks every active fact by similarity (it sorts by score then a stable
    // tiebreak); we then take the top-K closest as merge candidates.
    const neighborsAll = await store.retrieve({
      scope,
      queryEmbedding: emb,
      budgetTokens: Number.MAX_SAFE_INTEGER,
      weights: { recency: 0, importance: 0, relevance: 1 },
      now,
    });
    const neighbors = neighborsAll.slice(0, topK);

    const decision = decideMerge(candidate, emb, neighbors);

    // [M4] Deterministic fact id from a structured, delimited tuple INCLUDING
    // `kind` — so same-turn same-text-different-kind candidates get DIFFERENT
    // ids. Same id on re-run → upsertFact rewrites the same row (idempotent).
    const idSource = JSON.stringify([
      scope.userId,
      scope.characterId,
      candidate.sourceTurnId,
      candidate.kind,
      normalize(candidate.text),
    ]);
    const id = hashId(idSource);

    const buildFact = (): MemoryFact => ({
      id,
      scope,
      text: candidate.text,
      kind: candidate.kind,
      embedding: emb,
      importance: candidate.importance,
      sourceSessionId: transcript.sessionId,
      sourceTurnId: candidate.sourceTurnId,
      createdAt: now,
      validAt: now,
      invalidAt: null,
      supersededBy: null,
    });

    switch (decision.action) {
      case "ADD": {
        await store.upsertFact(buildFact());
        added++;
        break;
      }
      case "UPDATE": {
        // [M1] Atomic replace: upsert-new + supersede-old commit together, so a
        // crash can never strand both facts active (which would make the retry
        // see the new fact as a duplicate and never retire the old one).
        await store.replaceFact(decision.targetFactId!, buildFact());
        superseded++;
        break;
      }
      case "DELETE": {
        await store.invalidate(decision.targetFactId!);
        invalidated++;
        break;
      }
      case "NOOP": {
        noop++;
        break;
      }
    }
  }

  // [M6] Store-clock contract. supersede/invalidate stamp invalid_at from the
  // store's OWN this.now(), not from `now`. promoteSession only controls the
  // timestamps it writes directly (fact createdAt/validAt above, and the
  // finalize marker via finalizeSession's `now`). For deterministic tests the
  // store MUST be constructed with the same fixed clock as `now`.

  // 8. Relationship update — finalize-only and atomic ([B1]/[B6]/[B7]).
  let relationshipUpdated = false;
  if (finalize) {
    if (alreadyFinalized) {
      // Cheap early-out; the in-txn check in finalizeSession is authoritative.
      relationshipUpdated = false;
    } else {
      const signals = deriveRelationshipSignals(transcript);
      // Do NOT pre-read the relationship or precompute `next` here ([M13]):
      // the read-modify-write happens atomically inside finalizeSession.
      const advanced = await store.finalizeSession(
        scope,
        transcript.sessionId,
        signals,
        now,
        updateRelationship,
      );
      relationshipUpdated = advanced;
    }
  }
  // finalize === false → checkpoints never advance the relationship and never
  // mark the session finalized.

  return { added, superseded, invalidated, noop, dropped, relationshipUpdated };
}
