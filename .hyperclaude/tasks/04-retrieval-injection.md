# 04 — Retrieval + injection (read path → instructions)

**Depends on:** 02 (store); ideally 03 (real data, but can develop against a
seeded fixture store). **Run:** `/hyperclaude:hyper-auto` with the prompt below.

## Goal

At session start, select a small memory set within a **token budget** and
compose it into `startSession({ instructions })` via the seam built in subtask
01. Cold-start (no query yet) uses recency + importance; after the first user
utterance, relevance is added via a single `updateSession` refresh. This closes
the cross-session loop: memory written in subtask 03 shows up in the next session.

## In scope

- **`renderMemoryBlock(facts)`** + **`renderRelationshipBlock(state)`** (product
  policy) → compact instruction text. Include a guard line: "memory is
  dated/contextual; confirm if unsure" to curb over-confidence.
- **Wire into `composeInstructions([...])`** (from subtask 01) →
  `startSession({ instructions })`. **No core change.**
- **Token budget:** fixed memory budget (start ~600 tokens); cut top-K within
  budget; facts before session summaries; include only the last 1–2 session
  summaries.
- **Cold-start scoring** (recency + importance, no query) for the startup block;
  then **one** optional `updateSession` with relevance added after the first
  user utterance. **Not per-turn** (prompt-cache / Realtime token cost).

## Out of scope

- Write path (subtask 03), corrections (subtask 05).

## Verify

- Seeded fixture store → assert which **fact-ids** land in the rendered block
  under budget; token-budget cap respected; cold-start path produces a block
  with no query; the memory block actually appears in the composed instructions
  string (unit-level).
- (Optional, live) cross-session continuity by hand.
- `pnpm verify` green.

## hyper-auto prompt

> Implement retrieval + injection per
> `.hyperclaude/tasks/04-retrieval-injection.md`: `renderMemoryBlock` /
> `renderRelationshipBlock` (with a "memory is contextual, confirm if unsure"
> guard line), wired into the `composeInstructions` seam from subtask 01 →
> `startSession({ instructions })` with no core change; a fixed memory token
> budget with top-K cut (facts before summaries, last 1–2 summaries only);
> cold-start scoring (recency + importance, no query) plus a single optional
> `updateSession` relevance refresh after the first user utterance (never
> per-turn). Add unit tests asserting fact-ids in the rendered block and budget
> enforcement, using a seeded fixture store. Honor all fixed constraints in
> `.hyperclaude/tasks/README.md`. Verify with `pnpm verify`.
