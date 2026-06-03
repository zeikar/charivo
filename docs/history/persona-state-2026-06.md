# Persona State — 2026-06

Make the companion's tone AND recall vary by relationship state, and make it
situationally present (knows the current local moment) — deepening p4-01's
relationship block. Recorded 2026-06-03.

## Goal

Two new instruction axes so the companion feels appropriately close or careful
depending on how long you've known each other AND responds naturally to the time
of day/week — without hard-coding greeting scripts.

## The two axes

### (A) Relationship-state guidance — gated

`src/memory/relationship-guidance.ts` consumed by `render-memory.ts`'s
`renderRelationshipBlock`.

Threshold constants:

| Constant | Value |
| --- | --- |
| `RAPPORT_WARM_MIN` | `0.3` |
| `RAPPORT_STRAINED_MAX` | `-0.3` |
| `STALE_AFTER_MS` | `14 days` |
| `EARLY_RETURNING_MAX` | `1` |

Directive IDs (the `DIRECTIVE` map, `as const`; typed as `DirectiveId`):

- `rapport_low_restraint` — hold back on warmth when rapport is low
- `rapport_high_proactive_recall` — proactively recall shared context when rapport is high
- `cadence_early_no_intimacy` — no intimacy in early sessions
- `cadence_returning_after_gap` — acknowledge the gap when returning after a long absence
- `restraint_no_overrecall` — do not force-recall facts for the sake of it
- `uncertainty_hedge` — hedge when memory confidence is low

`selectDirectiveIds(state, ctx?)` picks the applicable ids from the state;
`renderGuidanceFromIds(ids)` renders them to text; `renderRelationshipBlock`
appends these directives after the p4-01 address/rapport/session lines.
Still gated: returns `""` when `sessionCount <= 0` (first meeting).

### (B) Situational date/time — ungated

`src/app/lib/situational-context.ts` exports `renderSituationalContext(localDate: Date)`.

- Injects the user's local weekday + date + clock time as a **bare fact** — no
  greeting instruction.
- One hand-coded behavior: a calmer nudge when `hour >= LATE_HOUR_START (22)`
  or `hour < LATE_HOUR_END (6)`.
- Formatted from fixed `WEEKDAYS` / `MONTHS` arrays — NOT `toLocaleString` —
  for locale-independent determinism.
- No daypart bucketing.
- Ungated: always present, even for a first-time visitor.

## Boundaries / design decisions

**(a) Guidance text, not retrieval mechanics.** "Recall varies by state" means
the directives tell the model how to handle what is already in the memory block;
no retrieval, scoring, or extraction file changed.

**(b) Inject facts the model acts on; hand-code only what it won't self-do.**
The situational line is a bare fact (local weekday + date + time) — the model
decides how to greet, hook on the day, and sense the season itself. There are NO
hand-coded greeting directives. The only hand-coded situational behavior is the
late-night calmer nudge, because unprompted tone-calming at 2 am is not
something the model reliably self-applies.

**(c) Deterministic tests as the persona-consistency gate.** The unit tests for
`relationship-guidance.ts` and `situational-context.ts` are the mechanical
correctness gate for what gets injected. A model-output "feel" eval (does she
actually sound warmer at high rapport? does she acknowledge midnight?) is
**deferred to Phase 5** — no eval harness ships in p4-02.

**(d) Clock threaded explicitly from compose sites.** Both compose sites in
`useRealtimeSession.ts` read a single `const now = new Date()` and pass
`now.getTime()` to the relationship layer and `now` to the situational layer.
The pure modules (`relationship-guidance.ts`, `situational-context.ts`) import
no presentation or theme code and read no clock internally.

## No changeset

`examples/companion` is changeset-ignored; this is a docs/example change only.
