# Execution Backlog

This file is the shared execution backlog for active work across agents and
sessions.
Use it for short-horizon implementation priorities and handoff context, not for
long-term product planning.

## How To Use

- Keep `roadmap.md` as the phase and milestone document.
- Keep this file focused on the next concrete work items.
- Prefer short outcome-driven entries over implementation logs.
- If an item grows beyond a few bullets, move the detail into an issue, PR, or
  dedicated design doc.
- Remove completed items or move them into a short `Recently Done` section.

## Now

- [P0] Define a baseline measurement pass for `examples/web`
  Outcome: capture response start latency, interruption recovery, and lip-sync
  stability for the current realtime stack.
  Notes: approximate latency covered via the voice smoke suite — useful for
  catastrophic-regression and variance trends, but still includes session→mic
  drift. Interruption recovery and lip-sync remain manual observation.
  Tightening the latency signal requires surfacing
  `realtime:user:speech_stopped` when a clean number becomes necessary.

- [P0] Clean up realtime turn UX
  Outcome: define and implement a clearer model for assistant drafts, final
  utterances, interruption artifacts, and reconnect-visible state.
  Notes: this is the most immediate product-facing gap after avatar control.

- [P1] Tune avatar action prompting and tool usage
  Outcome: make motion and gaze usage feel intentional instead of
  expression-heavy.
  Notes: default realtime prompting now biases lightweight reactions toward
  `lookAt`, keeps `setExpression` from soaking up every polite beat, and uses
  stricter wording against spoken tool-name / parenthetical action leakage.
  `examples/web` also has an app-layer realtime instruction composition point
  instead of pushing product-specific acting guidance into `@charivo/realtime`.
  Remaining work is mostly manual evaluation against the actual Amadeus target
  before adding new primitives.

- [P1] Decide whether `setIdleMode` is a real primitive
  Outcome: make an explicit keep/remove decision for idle control.
  Notes: if idle stays implicit, document where renderer- or state-driven idle
  behavior should live.

## Next

- [P1] Validate current avatar action behavior against the Amadeus target
  Outcome: identify where the demo still feels generic instead of characterful.
  Notes: use the current canonical `expression`, `motion`, and `gaze` path as
  the baseline.

- [P1] Define reconnect and session-refresh UX expectations
  Outcome: decide what state should survive reconnects and where refresh cost is
  acceptable.
  Notes: this should feed directly into Phase 2 turn UX and session work.

- [P1] Decide whether non-realtime responses should drive avatar actions
  Outcome: either keep avatar actions realtime-only or define a separate
  explicit contract for turn-based paths.
  Notes: do not revive the old emotion-tag approach.

## Later

- [P2] Design the memory schema and promotion rules
  Outcome: define short-term, medium-term, and long-term memory boundaries.

- [P2] Design the Amadeus persona and state model
  Outcome: define relationship-driven tone, situational modes, and response
  behavior.

- [P2] Define the evaluation set and operating thresholds
  Outcome: establish repeatable checks for latency, interruption recovery,
  memory precision, and persona consistency.

## Open Questions

- Is idle control an explicit primitive or should it remain renderer-managed?
- Should non-realtime avatar actions exist at all?
- What is the first concrete Amadeus persona acceptance test?

## Recently Done

- Added a voice smoke suite (`tests/webrtc-smoke/realtime-voice-*.spec.ts`)
  that feeds a canned WAV through Chromium's fake mic. `voice-e2e` drives the
  full tool-enabled turn; `voice-baseline` strips tools for a cleaner latency
  signal. Both share `playwright.voice.config.ts` so adding more voice specs
  does not grow the script surface.
- Fixed off-by-one completion events in both realtime adapters: tool-using
  turns used to emit `assistant.response.completed` twice (once with stale or
  empty text at the tool boundary, then again with the real reply). Consumers
  now see one start/done pair per user turn.
- Tightened the default realtime agent instructions and `lookAt` tool
  description to suppress spoken tool/action leakage, bias lightweight
  reactions toward gaze, and treat natural directional phrases as gaze
  triggers. Live default-prompt evaluation still exercises `expression`,
  `motion`, and `gaze` successfully after the prompt changes.
- Added an app-layer realtime instruction composition helper in `examples/web`
  so product-specific acting guidance can be appended on top of the generic
  library defaults without expanding the `@charivo/realtime` public contract.
- Canonical realtime avatar control now uses `expression`, `motion`, and `gaze`
  instead of the old emotion shorthand.
- `examples/web` already exposes realtime avatar debug visibility for tool
  calls and applied actions.
- Repo-wide `pnpm verify` passes without lint noise from generated `docs-site`
  output.
