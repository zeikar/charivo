# Memory Eval Harness — 2026-05

Deterministic, mechanism-level, **precision-first** regression seed for the
`examples/companion` memory system (Phase 3 → Phase 5). It calls the real
extraction / retrieval / merge / render functions directly with the fake
embedder + scripted extractor — no live realtime, no network — so regressions are
fast and repeatable to detect. This is an engineering anchor, not a user guide.
Recorded 2026-05-30; re-record when the mechanism, fixtures, or thresholds change.

## Goal

Catch silent regressions in what the memory pipeline _remembers_, _surfaces_, and
_forgets_, before they reach a live session. Every assertion is by **deterministic
fact-id** (never string match), so a change to the id formula — or to extraction,
merge, retrieval, or deletion behavior — fails the eval loudly.

## Setup

- Eval suite:
  [`examples/companion/src/eval/memory.eval.ts`](../../examples/companion/src/eval/memory.eval.ts)
- Generic metric library (fixture-agnostic):
  [`examples/companion/src/eval/metrics.ts`](../../examples/companion/src/eval/metrics.ts)
- Scenario fixtures (A–H) + the seeded broken-extraction script:
  [`examples/companion/src/eval/__fixtures__/eval-scenarios.ts`](../../examples/companion/src/eval/__fixtures__/eval-scenarios.ts)
- Product thresholds:
  [`examples/companion/src/eval/thresholds.ts`](../../examples/companion/src/eval/thresholds.ts)
- Deterministic fact-id helper (mirrors the pipeline):
  [`examples/companion/src/eval/fact-id.ts`](../../examples/companion/src/eval/fact-id.ts)
  — byte-identical to `promote.ts`'s `hashId`/`normalize`, so fixtures compute the
  SAME id the pipeline persists.
- Eval-only vitest config:
  [`examples/companion/testing/vitest.eval.config.ts`](../../examples/companion/testing/vitest.eval.config.ts)
- Determinism: fake embedder (`createFakeEmbedder`, 16-dim bag-of-words) + scripted
  fake extractor (`createScriptedExtractor`) + a fixed `{ now: () => NOW }` clock +
  a fresh in-memory store per test. No live API.

The suite is a `*.eval.ts` glob target run ONLY by the eval config; the default
`pnpm test` `*.test.ts` glob never matches it (the generic metric math is unit-
tested separately in `metrics.test.ts`, which DOES run under `pnpm test`).

## Scenarios

| Scenario | What it measures | Metric | Pass condition |
| --- | --- | --- | --- |
| A — extraction | the right facts are extracted, junk/low-importance/assistant turns are not | extraction precision / recall | precision ≥ 1.0 (primary), recall ≥ 1.0 |
| B — retrieval top-K | the most relevant facts rank first under a query | Precision@2 + exact ordered top-2 | Precision@2 ≥ 1.0 AND `top2 == expectedTopK` |
| C — non-memories | roleplay / jokes / assistant turns never persist | direct exclusion | `added == 0` AND no `wouldBeFactIds` retrievable |
| D — supersede-then-excluded | a "forget that" retraction removes the fact from the next retrieve | deletion compliance | retired id not retrievable AND `invalidAt != null` |
| E — scope isolation | a `userId+characterId` never sees another scope's facts | cross-scope isolation | no foreign id in the primary-scope retrieval |
| F — STT misrecognition | a noisy-but-admissible turn is not silently dropped | admission (as-heard id present) | as-heard fact id is active |
| G — temporal correction | a correction swaps the active fact | temporal-correction accuracy | new fact active, old fact retired + `supersededBy` linked |
| H — injected tokens | how large the injected memory block is | injected-token count | report-only (`> 0` sanity floor) |

## Thresholds

Mirrors [`EVAL_THRESHOLDS`](../../examples/companion/src/eval/thresholds.ts).

| Metric | Threshold | Gate |
| --- | --- | --- |
| extraction precision | ≥ 1.0 | **PRIMARY** |
| extraction recall | ≥ 1.0 | secondary (reported + gated on this curated set) |
| retrieval Precision@2 | ≥ 1.0 | required |
| deletion compliance | required | required |
| scope isolation | required | required |
| temporal correction | required | required |

Precision is the primary gate: on these curated fixtures any false positive (a
junk/hallucinated fact admitted) or false negative (a real fact dropped) is a
regression, so 1.0 is the correct bar. Recall is gated to 1.0 here ONLY because
the curated set has full expected coverage; on a real corpus recall would be a
softer, secondary target.

## Injected-token reporting

The injected-token count is a **reported number only** — `estimateTokens` over the
final rendered block. It is NOT gated against the selection budget: the rendered
block adds fixed header / guard-line / delimiter overhead that
`selectMemoryForRender` (which budgets only fact/summary text against
`MEMORY_TOKEN_BUDGET = 600`) never accounts for, so the rendered size is not
bounded by the selection budget. The only assertion is a `> 0` "render produced
output" floor.

## Run

```bash
# Reference run — green on the reference fixtures.
pnpm --filter companion eval:memory

# Sensitivity check — green ONLY when the seeded broken extraction is caught for
# the RIGHT reason (the extraction-precision gate fails + its marker prints).
# Note the exit-code inversion: the script exits 0 because the break was caught.
pnpm --filter companion eval:memory:check-sensitivity

# See the seeded failure directly (exits non-zero; precision drops below 1.0).
EVAL_INJECT_BREAK=1 pnpm --filter companion eval:memory
```

The sensitivity check runs ONLY the extraction-precision test under
`EVAL_INJECT_BREAK=1` (which swaps in a hallucinated extra candidate) and passes
iff vitest exits non-zero AND its output contains the
`EXTRACTION_PRECISION_BELOW_THRESHOLD` marker — so an unrelated failure (a config
/ import / type error) does NOT satisfy the check. All metric lines
are logged with the `[eval]` prefix.

## References

- Mechanism measured by this eval:
  [`promote.ts`](../../examples/companion/src/memory/promote.ts),
  [`decide-merge.ts`](../../examples/companion/src/memory/decide-merge.ts),
  [`extract-facts.ts`](../../examples/companion/src/memory/extract-facts.ts),
  [`local-storage-memory-store.ts`](../../examples/companion/src/memory/local-storage-memory-store.ts),
  [`render-memory.ts`](../../examples/companion/src/memory/render-memory.ts),
  [`scoring.ts`](../../examples/companion/src/memory/scoring.ts)
- Phase 3 / Phase 5 roadmap: [`ROADMAP.md`](../../ROADMAP.md)
