# 03 — Promotion pipeline (write path)

**Depends on:** 02. **Run:** `/hyperclaude:hyper-auto` with the prompt below.

## Goal

Turn a finished or checkpointed session into durable memory:
`summarize → extract → policyFilter → merge-decide → persist`, plus a
deterministic relationship-state update. Triggered on **session end + periodic
checkpoint**, idempotent. The model never writes — the app server does, after
the fact.

## In scope

- **Trigger wiring** in companion: on session end AND every N turns / salient
  event, enqueue an idempotent write job (safe if it fires twice or the session
  ends abnormally — tab close / reconnect failure must not lose memory).
- **`extractFacts(transcript, scope)`** → candidates, each carrying
  `sourceTurnId` + `importance`. **User-utterance turns only**; model turns
  excluded; **drop candidates without citable turn evidence** (hallucination
  filter). LLM extractor behind an interface; deterministic scripted fake for tests.
- **`policyFilter(candidate)`** seam — **pass-through in MVP** (no sensitive
  filter), but the seam must exist for a later privacy policy.
- **`decideMerge(candidate, neighbors)`** → `ADD | UPDATE | DELETE | NOOP`
  (mem0-style), comparing against the top-K similar existing facts.
  `UPDATE`/`DELETE` map to `supersede`/`invalidate` — **never destructive**.
  Precision-first: `NOOP` on ambiguity, importance threshold to admit.
- **Relationship update:** deterministic rules (`sessionCount++`, `lastSeenAt`,
  small `rapport` adjustment from signals, `addressStyle`). Not model-written.
- Persist everything via `MemoryStore` (`saveSession`, `upsertFact`,
  `supersede`/`invalidate`, `putRelationship`).

## Out of scope

- Retrieval / injection (subtask 04).
- Voice "forget that" detection (subtask 05).
- Editor UI.

## Verify

- Fixture transcripts → expected candidate facts and merge decisions
  (deterministic; scripted fake extractor). 
- **Idempotency:** running the pipeline twice yields the same store state.
- `pnpm verify` green.

## hyper-auto prompt

> Implement the promotion (write) pipeline per
> `.hyperclaude/tasks/03-promotion-pipeline.md`: idempotent triggers on session
> end + periodic checkpoint; `extractFacts` (user turns only, requires
> `sourceTurnId` evidence, drops unsupported candidates) behind a fake-able
> extractor; a pass-through `policyFilter` seam; `decideMerge` →
> ADD/UPDATE/DELETE/NOOP mapping UPDATE/DELETE to supersede/invalidate
> (precision-first, NOOP on ambiguity); deterministic relationship-state update;
> persistence via the `MemoryStore` from subtask 02. Add fixture-based
> deterministic tests including an idempotency test. Honor all fixed constraints
> in `.hyperclaude/tasks/README.md`. Verify with `pnpm verify`.
