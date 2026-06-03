# Avatar Tool-Misuse Eval — Tier 1 (Deterministic) — 2026-06

Deterministic tool-misuse eval for the `examples/companion` avatar-control
layer (Phase 5). Recorded 2026-06-03. Contrasts with the
[memory eval](memory-eval-2026-05.md) (exact fact-id arithmetic) and the
[persona eval](persona-eval-2026-06.md) (LLM generation, advisory, paid): this
tier makes **zero network calls**, is **always gated in CI**, and asserts
wiring / arg-validity / leakage-classification — not vibes. Every assertion
lives in a regular `*.test.ts` file and runs under `pnpm test` / `pnpm verify`.

The `(a)`–`(e)` labels below refer to the Phase 5 tool-misuse taxonomy:
(a) narration leakage, (b) available-tool wiring, (c) over-call / rapid-fire
chaining, (d) arg-validity, (e) no-call when unwarranted.

## What This Tier Gates

All of the following are deterministic, no model, no network, and always in CI:

**Available-tool wiring per character (b)**

[`tool-gating.test.ts`](../../examples/companion/src/eval/tool-misuse/tool-gating.test.ts)
parses the real `model3.json` assets in Node (via a local `loadCatalogFromModel3`
helper that mirrors `getAvailableExpressions` / `getAvailableMotionGroups`) and
asserts that:

- **Hiyori** (`companion-default`) — `setExpression` is absent from the
  registered tool list because her catalog has zero expressions; `playMotion`
  and `lookAt` are present.
- **Yuki** (`companion-genki`) — all three tools (`setExpression`, `playMotion`,
  `lookAt`) are present in registration order.

Instruction prose is also gated: Hiyori's assembled `buildAvatarControlInstructions`
output must not contain the string `setExpression`; Yuki's must contain it.
Because the test reads the real assets, any catalog drift (expressions added or
removed) immediately fails the suite.

**Handler arg-validity matrix (d)**

The same file asserts handler behavior for each tool:

- `setExpression` rejects an unrecognised `expressionId`.
- `playMotion` rejects an out-of-range index, a non-integer index, and an
  unknown group.
- `lookAt` rejects `NaN` and non-numeric `x` — but **clamps** out-of-range gaze
  values (e.g. `x: 4` → `x: 1`) rather than throwing. This clamp-not-throw
  distinction is explicitly asserted.

**Leakage classifier (a)**

[`tool-leakage.test.ts`](../../examples/companion/src/eval/tool-misuse/tool-leakage.test.ts)
exercises the pure
[`detectToolLeakage(text)`](../../examples/companion/src/eval/tool-misuse/tool-leakage.ts)
function over a 9-row table of clean vs dirty strings — 4 clean (normal
spoken text), 5 dirty (literal tool names, JSON-ish arg fragments, bracketed
action notes, parenthetical annotations). No model, no network.

## What Is Deferred (Needs Model Output)

Two misuse modes are inherently non-deterministic because they require the
model to actually emit — or consciously refrain from — tool calls:

- **(c) Over-call / rapid-fire chaining** — the model chains unnecessary tool
  calls across a single turn.
- **(e) No-call when unwarranted** — the model emits a tool call when none was
  appropriate.

There is no deterministic source for these at Tier 1, so they are **not**
shipped as synthetic-fixture metrics (that would test the test, not the model).

Currently these modes are only **observed / logged** by
[`tests/webrtc-smoke/realtime-avatar-prompt.spec.ts`](../../tests/webrtc-smoke/realtime-avatar-prompt.spec.ts):
turn-4 logs tool counts and unique tool types but has **no** over-call or
no-call assertion. **(c) and (e) remain deferred** to a future tier that
captures real model output and applies a post-hoc gate.

## Catalog Source of Truth

`tool-gating.test.ts` resolves catalog data at describe scope using
`loadCatalogFromModel3`, a small local helper that opens the model3.json with
`readFileSync`, walks `FileReferences.Expressions` and
`FileReferences.Motions`, and returns the same shape that the runtime
`getAvailableExpressions` / `getAvailableMotionGroups` pair produces. The
two assets it reads:

- **Hiyori**: [`examples/companion/public/live2d/Hiyori/Hiyori.model3.json`](../../examples/companion/public/live2d/Hiyori/Hiyori.model3.json)
- **Yuki**: [`examples/companion/public/live2d/sample-model-basic-series-v3_vts/sample-model-basic-series-v3.model3.json`](../../examples/companion/public/live2d/sample-model-basic-series-v3_vts/sample-model-basic-series-v3.model3.json)

Any edit to those assets that changes the expression or motion counts will
break the catalog-parse sanity suite (four assertions) before any wiring test
has a chance to misfire silently.

## What Is Not Rebuilt

Real-model realtime tool behavior is already covered by the live eval harness:

- [`tests/webrtc-smoke/realtime-avatar-prompt.spec.ts`](../../tests/webrtc-smoke/realtime-avatar-prompt.spec.ts)
- [`docs/history/avatar-prompt-eval-2026-04.md`](avatar-prompt-eval-2026-04.md)

Tier 1 does not run a model. It is complementary to — not a replacement for —
the WebRTC smoke suite.

## Declined: A Chat-Completions Proxy Tier

A tier using a chat-completions proxy (instead of the WebRTC realtime API) was
considered and declined for structural reasons:

1. **Leakage (a) is suppressed by construction.** A tool call goes to
   `tool_calls` in the chat-completions response, not to `content`. A proxy
   tier cannot observe narration leakage because the protocol hides it.
2. **Realtime cadence (c) is flattened.** Over-call timing and rapid-fire
   chaining are realtime-session phenomena. A single-shot chat-completions
   call cannot reproduce the turn structure where the failure occurs.

Both points are reinforced by the 2026-04 findings: text leakage was not
reproducible in the smoke environment even with a real live session, and
negative-shot anti-leakage examples (v4) actively backfired — the model
copied the labelled-Wrong pattern verbatim and function-call rate dropped
from 5/5 to 1/5. Attempting to gate leakage through a proxy tier would give
a permanently-green signal on a failure mode that the probe cannot see.

As a **future option** (not done here): `detectToolLeakage` could be wired
into the companion's assistant-text display path as a runtime guard — stripping
or flagging leaked annotations before they reach the user. That is a runtime
behavior change and is out of scope for this eval.

## Run It

The eval files are regular `*.test.ts` files picked up by the root vitest
config. The working commands are:

```bash
# CI gate — runs all *.test.ts including the tool-misuse suite:
pnpm test
pnpm verify

# Target just the tool-misuse suite via the root runner (no key, no network):
pnpm vitest run examples/companion/src/eval/tool-misuse
```

> **Note:** `pnpm --filter companion exec vitest run src/eval/tool-misuse`
> is broken by a pre-existing PostCSS issue in the companion package. Use the
> root-runner form above when running this suite in isolation.

## References

- Source files:
  - [`examples/companion/src/eval/tool-misuse/tool-leakage.ts`](../../examples/companion/src/eval/tool-misuse/tool-leakage.ts)
  - [`examples/companion/src/eval/tool-misuse/tool-leakage.test.ts`](../../examples/companion/src/eval/tool-misuse/tool-leakage.test.ts)
  - [`examples/companion/src/eval/tool-misuse/tool-gating.test.ts`](../../examples/companion/src/eval/tool-misuse/tool-gating.test.ts)
- Prior art:
  - [`docs/history/avatar-prompt-eval-2026-04.md`](avatar-prompt-eval-2026-04.md)
  - [`tests/webrtc-smoke/realtime-avatar-prompt.spec.ts`](../../tests/webrtc-smoke/realtime-avatar-prompt.spec.ts)
- Phase 5 roadmap: [`ROADMAP.md`](../../ROADMAP.md)
