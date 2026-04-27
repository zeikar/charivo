# Avatar Prompt Engineering Experiments — 2026-04

Reference log for the prompt iterations attempted on the realtime avatar
addendum, default realtime prompt, and tool descriptions. Captures both what
shipped and what was tried and reverted, so future prompt work has a paper
trail of measured outcomes.

## Goal

Move the model from "exactly one tool call per turn" toward "naturally
combine an expression, gaze, and motion when the moment warrants it",
without breaking proactive tool usage and without introducing tool-name
leakage in the spoken text channel (e.g., `(setExpression: Smile) Hello`).

## Setup

- Live eval harness:
  [`tests/webrtc-smoke/realtime-avatar-prompt.spec.ts`](../../tests/webrtc-smoke/realtime-avatar-prompt.spec.ts)
- Test smoke catalog (`AVATAR_CATALOG` in
  [`tests/webrtc-smoke/src/main.ts`](../../tests/webrtc-smoke/src/main.ts)):
  - 1 expression: `Smile`
  - 2 motion groups: `Emphasis` (3 indices), `Wave` (1 index)
- Live model: OpenAI realtime via
  [`@charivo/realtime`](../../packages/realtime/) + the WebRTC harness
- Repetition: each variant run with `playwright test --repeat-each=5 --workers=1`
- Prompt layers (composed in this order at session start):
  1. `DEFAULT_REALTIME_AGENT_INSTRUCTIONS` from
     [`packages/realtime/src/instructions.ts`](../../packages/realtime/src/instructions.ts)
  2. Avatar instruction addendum from
     [`buildAvatarControlInstructions(catalog)`](../../packages/realtime-avatar/src/index.ts)
  3. Tool descriptions on each registered function (`setExpression`,
     `playMotion`, `lookAt`)
- Probes:
  - Turn 1 (greeting), Turn 2 (motion request), Turn 3 (gaze request) —
    regression guards: each must fire its named tool at least once.
  - Turn 4 (pairing probe) — emotional, no tool naming. Logs tool count and
    unique tool types; no strict assertion. Used to measure whether the
    model picks 2+ tools when the prompt allows it.

## Variants Tested

| Tag | Change relative to prior | Turn 1 firing | Pairing (Turn 4) | Text leakage |
|-----|-------------------------|--------------:|-----------------:|--------------|
| v1  | Lever 1: relax avatar addendum's "Prefer one well-timed action" line | 5/5 | 0/5 | not observed in smoke |
| v2  | Senior rewrite: descriptive addendum with concrete pairing examples; tool descriptions drop "single", "one", "at most one"; default prompt drops "Prefer one well-timed tool action" | 5/5 | 0/5 | not observed in smoke |
| v3  | Strip `setExpression` literal from addendum prose, replace with "Set a fitting expression" | **0/5** | n/a | model substituted `[smiles warmly]` brackets |
| v4  | Restore `setExpression` mention + add explicit negative-shot example (`Wrong: "(setExpression: Smile) Hello." ... Right: "Hello."`) to default prompt | 1/5 | n/a | model copied the `(Smile)` example verbatim |
| v5 (= v2) | Revert v3/v4. Ship v2 baseline. | 5/5 | 0/5 | not observed in smoke |

Shipping state: v2 / v5 with a post-review guard: pairing guidance is now
emitted only when both expression and motion tools are available, and examples
avoid naming motions that may not exist in the active catalog. See
[`.changeset/descriptive-avatar-prompts.md`](../../.changeset/descriptive-avatar-prompts.md).

## Findings

### 1. Pairing rate needs both prompt and catalog support

Across v1, v2, and v5 — three meaningfully different prompt formulations —
the turn-4 pairing rate stayed at 0/5. At the time of those runs, the smoke
catalog only exposed `Smile` and `Emphasis`, which made warm greeting-style
pairings hard to express through the available motion enum. The harness now
also exposes `Wave` so future runs can measure whether the model picks a
more natural expression + motion pair.

### 2. Tool-name mentions in prose are load-bearing for tool use

v3 removed `setExpression` from the addendum prose (replaced with the
generic verb phrase "Set a fitting expression"). Function call rate
collapsed from 5/5 to 0/5, and the model substituted bracketed action
notes (`[smiles warmly]`) in the spoken channel. The literal tool name
in prose was priming both the function call AND the (occasional) text
echo. Removing it kills both, with the function call being the more
valuable side.

### 3. Negative-shot examples backfire in this context

v4 added `Wrong: "(setExpression: Smile) Hello." or "[smiles warmly]
Hello." Right: "Hello."` as defense against text leakage. Result:
- Function call rate dropped to 1/5.
- One run produced `(Smile) I'm so glad you're here` — the model copied
  the labelled-Wrong pattern verbatim.

The negative example pattern primed the very output it was supposed to
suppress, and the strong "do not say setExpression" pressure made the
model conservative about firing the function at all. Pattern priming
overrides label semantics — a known LLM phenomenon worth keeping in
mind for spoken-channel prompts.

### 4. Production text leakage is not reproducible in smoke

The original report came from the demo web app with a real Hiyori catalog
(multiple expressions), Korean assistant output, and longer accumulated
conversation context. None of the eval variants reproduced that leakage
in the English single-expression smoke environment. Likely contributors:
multilingual instruction-following weakening, longer context, and a
larger expression namespace — none cleanly addressable through prompt
tweaks alone.

## Recommendations Going Forward

- **Do not chase pairing through prompt language alone.** Three variants
  produced no movement before the catalog was expanded. Keep rerunning the
  eval with the `Wave` group, and also run it against the demo's Hiyori
  catalog when checking production-like behavior.
- **Probe design still matters.** If pairing stays flat, redesign the turn-4
  prompt to invite embodied reaction rather than verbal sharing.
- **Do not use negative-shot examples to suppress tool-name leakage in
  the spoken channel.** Measured worse on every metric.
- **Address the production leakage at the client layer.** A short regex
  strip on the assistant text before display (e.g., remove leading
  parenthesised tool annotations and bracketed action notes) is reliable
  and has no risk of regressing tool calls. Treat the prompt as
  best-effort; treat the client as the guarantee.

## References

- Prompt sources:
  - Default realtime: [`packages/realtime/src/instructions.ts`](../../packages/realtime/src/instructions.ts)
  - Avatar addendum + tool descriptions: [`packages/realtime-avatar/src/index.ts`](../../packages/realtime-avatar/src/index.ts)
- Test assertions:
  - [`packages/realtime/__tests__/realtime-core.test.ts`](../../packages/realtime/__tests__/realtime-core.test.ts)
  - [`packages/realtime-avatar/__tests__/realtime-avatar.test.ts`](../../packages/realtime-avatar/__tests__/realtime-avatar.test.ts)
  - [`examples/web/src/app/lib/realtime-instructions.test.ts`](../../examples/web/src/app/lib/realtime-instructions.test.ts)
- Live eval harness:
  [`tests/webrtc-smoke/realtime-avatar-prompt.spec.ts`](../../tests/webrtc-smoke/realtime-avatar-prompt.spec.ts)
- Run command:
  `RUN_LIVE_REALTIME_TESTS=1 OPENAI_API_KEY=... pnpm exec playwright test -c playwright.webrtc.config.ts --repeat-each=5 --workers=1 tests/webrtc-smoke/realtime-avatar-prompt.spec.ts`
