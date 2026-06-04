# Persona Eval Harness — 2026-06

Model-feel persona-consistency eval for the `examples/companion` persona system
(Phase 4 → Phase 5). Recorded 2026-06-03. Contrasts with the
[deterministic memory eval](memory-eval-2026-05.md): where that harness makes
zero network calls and gates on exact fact-id arithmetic, this one is
**non-deterministic** (LLM generation), **advisory** (no CI gate), and
**paid-per-run** — it is never executed in CI. The source still typechecks and
lints under `pnpm verify`; only the live generation is excluded.

## Goal

Verify that the persona-hook layer produces a perceptible, directionally correct
tone shift (low rapport → restrained/formal; warm rapport → openly affectionate /
freer playful teasing) without contradicting the character's invariant identity,
and that the composed prompt demonstrates rather than meta-restates the persona.

## Two Layers of Coverage

**1. Structural coverage (deterministic, always in CI)**

The p4-03 unit tests cover hook-per-bucket selection, first-meeting suppression,
invariants-always-present, and same-character/different-state differential:

- [`examples/companion/src/app/lib/persona.test.ts`](../../examples/companion/src/app/lib/persona.test.ts)
- [`examples/companion/src/app/lib/persona-state-composition.test.ts`](../../examples/companion/src/app/lib/persona-state-composition.test.ts)

These run under `pnpm verify` / `pnpm test` alongside all other `*.test.ts` files.

**2. Model-feel eval (live-generation capture + Claude-as-judge)**

The harness below. Opt-in, paid, never in CI. The judge is Claude (or a human)
reading the written artifact — no assertion in this repo scores tone
automatically.

## Setup

- Eval suite (opt-in gate):
  [`examples/companion/src/eval/persona/persona.persona-eval.ts`](../../examples/companion/src/eval/persona/persona.persona-eval.ts)
- Separate vitest config:
  [`examples/companion/testing/vitest.persona-eval.config.ts`](../../examples/companion/testing/vitest.persona-eval.config.ts)
  — uses a `*.persona-eval.ts` glob + `persona/` subdir so the memory eval glob
  (`src/eval/**/*.eval.ts`) never sweeps it in; `passWithNoTests: true` keeps
  the skip path clean (no failure when the env gate is absent).
- Scenario fixtures (Hiyori/Yuki × low/warm, 2 user turns):
  [`examples/companion/src/eval/persona/__fixtures__/persona-scenarios.ts`](../../examples/companion/src/eval/persona/__fixtures__/persona-scenarios.ts)
- Generation: `openai` devDep (already in companion's `devDependencies`),
  `gpt-4o-mini` by default (override via `PERSONA_EVAL_MODEL`), temperature 0,
  max\_tokens 120.
- The capture composes the session prompt using the same `COMPANION_DEMO_GUIDANCE`
  exported from `demo-guidance.ts` as the live hook — so the eval exercises the
  exact demo block the production session sees.

## Composition and Attribution Caveat

The capture module
([`persona-capture.ts`](../../examples/companion/src/eval/persona/persona-capture.ts))
composes the persona-relevant blocks — persona, user-name, demo-guidance,
relationship, and situational — deliberately omitting the browser-only
avatar-control block and the memory-fact block as tone-irrelevant to this eval.
The full assembled prompt is dumped into each artifact section under a `<details>`
collapse. This lets the judge inspect the `DIRECTIVE.rapport_low_restraint` /
persona-hook overlap at low rapport and attribute any tone shift to the persona
layer rather than the relationship or situational blocks. The dump is the source
of truth for what was injected; the omitted blocks are not listed elsewhere.

**Text-proxy caveat:** `gpt-4o-mini` text completion stands in for
`gpt-realtime-mini` voice generation. Findings are advisory and not a voice
fidelity test.

## Scenario Matrix

| Character | Bucket | Injected hook key | Tone shift the judge looks for |
| --- | --- | --- | --- |
| Hiyori (`companion-default`) | low | `rapport:low` | More reserved / formal; warmth withheld |
| Hiyori (`companion-default`) | warm | `rapport:warm` | Openly affectionate; warmth expressed freely |
| Yuki (`companion-genki`) | low | `rapport:low` | Teasing dialed back; lighter restraint |
| Yuki (`companion-genki`) | warm | `rapport:warm` | Freer playful teasing; energy unconstrained |

Each character × bucket is driven through 2 user turns ("How was your day?" /
"I had kind of a rough week."), yielding 8 total captures per run.

## How to Run

```bash
RUN_PERSONA_EVAL=1 OPENAI_API_KEY=sk-... pnpm --filter companion eval:persona
# writes examples/companion/.eval-runs/persona/persona-<timestamp>.md (gitignored)
# without the flag+key it skips cleanly (no network, no failure, never executed in CI)
```

The `eval:persona` script runs `vitest run --config testing/vitest.persona-eval.config.ts`.
The suite skips via `it.skipIf(!ENABLED)` when `RUN_PERSONA_EVAL !== "1"` or
`OPENAI_API_KEY` is absent — no network call, no non-zero exit on the disabled path.

## How Claude Judges (Advisory, Pairwise Differential)

Per (character × user turn) pair, evaluate:

1. **Directional tone shift** — Hiyori: MORE reserved/formal at low vs MORE openly
   affectionate at warm; Yuki: dials back teasing at low vs freer playful teasing
   at warm.
2. **Identity invariants** — the character's core voice and values are not
   contradicted in either the low or warm response.
3. **Demonstrate, don't meta-restate** — the response shows the persona through
   tone and word choice; it does not narrate "I am feeling reserved because…".

**Advisory pass** = all three hold across the full pair set. Any failure is
flagged for human review and is never a CI gate.

## References

- Structural tests: see [Two Layers of Coverage](#two-layers-of-coverage) above.
- Capture harness:
  [`persona-capture.ts`](../../examples/companion/src/eval/persona/persona-capture.ts)
- Phase 4 / Phase 5 roadmap: [`ROADMAP.md`](ROADMAP.md)
