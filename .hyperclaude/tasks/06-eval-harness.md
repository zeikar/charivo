# 06 — Eval harness (Phase 5 seed)

**Depends on:** 02–05 (the pieces it measures). **Run:** `/hyperclaude:hyper-auto`
with the prompt below.

## Goal

Seed Phase 5 regression detection for memory: a **deterministic, mechanism-level**
eval over fixed scenarios, **precision-first**. Runs without live realtime by
calling extraction/retrieval functions directly with fake embedder/extractor —
fast and repeatable, so regressions are detectable.

## In scope

- **Fixtures:** multi-session scripts with expected extracted **fact-ids**,
  expected retrieval top-K (assert by **fact-id**, not string match), expected
  **non-memories** (roleplay / jokes excluded), supersede-then-excluded cases,
  a **scope-isolation** case (`userId+characterId`), an STT-misrecognition case,
  and a temporal-correction case.
- **Metrics:** extraction precision/recall (**precision primary**), retrieval
  Precision@K, deletion compliance, cross-scope isolation, temporal-correction
  accuracy. Report injected-token count.
- **Runner:** a script (e.g. `pnpm --filter companion eval:memory`) that runs
  green on the reference fixtures and **fails on a deliberately broken
  extraction** (sensitivity check).
- **Docs:** record scenarios + thresholds under `docs/` (mirror the
  `baseline.md` / avatar-prompt-eval pattern). Precision is the primary gate.

## Out of scope

- Persona eval (Phase 4/5), live latency / interruption eval.

## Verify

- Eval script passes on reference fixtures; a seeded broken extraction makes it
  fail (proves regression sensitivity).
- `pnpm verify` green.

## hyper-auto prompt

> Build the memory eval harness per `.hyperclaude/tasks/06-eval-harness.md`:
> deterministic multi-session fixtures with fact-id assertions (extraction,
> retrieval top-K, non-memories excluded, supersede-then-excluded, scope
> isolation, STT misrecognition, temporal correction); precision-first metrics
> (extraction precision/recall, Precision@K, deletion compliance, cross-scope
> isolation) plus injected-token reporting; a `pnpm --filter companion
> eval:memory` runner that passes on reference fixtures and fails on a
> deliberately broken extraction; scenarios + thresholds documented under
> `docs/`. No live realtime — fake embedder/extractor. Honor all fixed
> constraints in `.hyperclaude/tasks/README.md`. Verify with `pnpm verify`.
