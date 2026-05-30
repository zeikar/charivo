# 05 — Correction / deletion path

**Depends on:** 02 (supersede/invalidate ops), 03 (extraction step is where
intent is detected). **Run:** `/hyperclaude:hyper-auto` with the prompt below.

## Goal

Make bad memory repairable **without a UI**: corrections are soft
(`invalidAt` / `supersededBy`, never destructive), and a spoken "forget that /
that's wrong" is detected in the post-session extraction step and queued as a
supersede. The model never writes long-term directly, so the effect lands at the
next session start.

## In scope

- **Voice correction/deletion intent detection** in the post-session extraction
  step → resolve target fact(s) → queue a supersede/invalidate applied app-side.
- **Replacement correction** ("I now live in Busan") → invalidate the old fact +
  insert the new one.
- **Acknowledgment / product copy**: note where to surface that a memory change
  takes effect from the next session start (model can't rewrite live).
- Confirms decision #7: **API/DB + voice detection only; no editor panel.**

## Out of scope

- User-facing memory editor UI (deferred).
- Hard GDPR-style "erase everything including transcript" — leave a seam/TODO
  only.

## Verify

- Fixture "forget X" transcript → X superseded and **excluded from the next
  `retrieve`**.
- Replacement correction → old fact invalidated, new fact active.
- Deterministic (scripted fake extractor).
- `pnpm verify` green.

## hyper-auto prompt

> Implement the correction/deletion path per
> `.hyperclaude/tasks/05-correction-deletion.md`: detect spoken "forget
> that"/"that's wrong" intent in the post-session extraction step, resolve the
> target fact(s), and queue an app-side supersede/invalidate (model never writes
> live); handle replacement corrections as invalidate-old + insert-new; note
> where to surface "takes effect next session". API/DB + voice detection only —
> no editor UI. Add deterministic fixture tests proving superseded facts are
> excluded from the next retrieve and replacements swap active fact. Honor all
> fixed constraints in `.hyperclaude/tasks/README.md`. Verify with `pnpm verify`.
