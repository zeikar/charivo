# Amadeus Roadmap

Created: 2026-04-14
Updated: 2026-06-04

Status: Phases 0-5 complete; v1 declared (2026-06-04). Archived here in
`docs/history/` as the completed product roadmap — now the product definition +
decision record + v1 bar, not an active plan.

## Purpose

Charivo is the framework. Amadeus is the first product target built on top of
it.

This was the single planning document for that effort. With all phases complete
it now stands as the product definition + decision record, kept short and
readable rather than a task dump.

## Product Goal

Build an Amadeus-like experience on top of Charivo: a persistent conversational
character that combines:

- realtime voice conversation
- Live2D-driven expression, motion, and gaze
- stable character identity and relationship continuity
- cross-session memory
- enough evaluation discipline to improve safely over time

This is not a framework-rewrite roadmap. The goal is to turn the existing
Charivo foundation into a product that feels specific, consistent, and durable.

## Constraints

- Keep the current layering:
  `@charivo/core -> modality root packages -> browser adapters -> server providers`
- Keep the current event split:
  `RenderManager.setEventBus(...)` and realtime/TTS/STT managers using
  `setEventEmitter(...)`
- Prefer extending adapters and app behavior over redesigning the architecture
- Keep Amadeus-specific memory, persona, and product logic outside
  `@charivo/*` core packages until the shape is stable
- Treat `examples/web` as the main product-validation surface

## Current Read

The project is no longer at the "can this work?" stage.

What already exists:

- live realtime voice through the OpenAI Agents path
- canonical avatar tools for expression, motion, and gaze
- renderer wiring for avatar actions and lip-sync
- reconnect-based `updateSession(...)`
- live smoke coverage for WebRTC prompt evaluation and voice latency trends
- app-layer instruction composition for product-specific acting guidance

A cross-session memory model with promotion rules, a typed relationship-state
model, and a precision-first memory eval now exist in `examples/companion`
(Phase 3). The persona model (Phase 4) and the evaluation + readiness surface
(Phase 5) are now in place as well:

- persona where tone and recall vary by relationship state (p4-02 / p4-03), no
  longer a single prompt paragraph
- evaluation breadth beyond memory precision — persona consistency and
  tool-misuse evals — plus an explicit release-readiness bar

## Phase Status

All phases (0-5) complete; v1 declared (see [v1 Definition](#v1-definition)).
Full per-phase narrative is in this file's git history; the durable design
decisions are kept compact below, and evidence lives in the linked docs.

- **Phase 0 — Product Definition & Baseline** (complete, 2026-05-29). Realtime
  baseline recorded — response-start latency, interruption, and lip-sync
  expectations — in [../baseline.md](../baseline.md). `examples/web` is the
  framework-validation surface.
- **Phase 1 — Avatar Expressiveness** (framework-complete). Canonical avatar
  primitives `setExpression` / `playMotion` / `lookAt`; the old emotion-shorthand
  path removed; prompting tuned away from expression spam toward lighter gaze.
  _Decision (2026-05-29):_ `setIdleMode` stays renderer/state-driven, **not** a
  per-turn primitive (idle is low-priority fallback filler, distinct from the
  directed actions; if ever needed, expose it as session config like
  `enableIdleFallback`, not a per-turn tool).
- **Phase 2 — Realtime Conversation UX** (complete, 2026-05-29). Live draft /
  final / interrupted artifacts + a Stop button; the interrupted-on-reconnect
  contract (in-flight responses marked interrupted, not resumed; the next fresh
  turn clears it) is locked by the `realtime-core` contract test. Finer
  reconnect-UX polish deferred as optional.
- **Phase 3 — Memory** (complete, 2026-06-03). Cross-session memory in
  `examples/companion` — extraction, policy filter, ADD/UPDATE/DELETE/NOOP merge,
  promotion, scored retrieval, typed relationship state, instruction injection —
  plus a precision-first eval
  ([memory-eval-2026-05.md](memory-eval-2026-05.md)). _Decisions:_ memory lives
  in the app/server layer (not `@charivo/*` core) behind a `MemoryStore`
  boundary; MVP persistence shipped browser-local (`LocalStorageMemoryStore`),
  with server SQLite + `pgvector` a later drop-in; scope is
  `userId + characterId`; the gate is precision-first; corrections are soft
  (`invalidAt` / `supersededBy`) plus spoken-retraction detection.
- **Phase 4 — Persona & State Model** (complete, 2026-06-03). Relationship- and
  situational-state guidance + a structured persona (`persona.ts`: invariant
  `voice` / `values` + state-conditional hooks) replacing the single personality
  string, injected at both realtime compose sites and locked by deterministic
  mapping tests ([persona-state-2026-06.md](persona-state-2026-06.md)).
- **Phase 5 — Evaluation & Readiness** (complete). Five eval surfaces — memory,
  persona ([persona-eval-2026-06.md](persona-eval-2026-06.md)), tool-misuse
  ([avatar-tool-misuse-eval-2026-06.md](avatar-tool-misuse-eval-2026-06.md)),
  and live voice-latency / interruption smoke — plus the release bar
  ([../release-bar.md](../release-bar.md)). A full IP / asset / voice-similarity
  review is deferred to a public-release decision, gated by the release bar (see
  the [Note](#note)).

## Immediate Focus

Phases 0-5 are complete and v1 is declared. The roadmap's phase work is done;
what remains is acting on the v1 milestone — any public/commercial release runs
against the [release bar](../release-bar.md) and the
[v1 Definition](#v1-definition) below.

Standing constraint: keep persona and eval logic in the app/server layer, not in
core packages.

## Package Map

### `examples/web`

Minimal framework demo — the reference for "how to use Charivo." Kept lean; it
does not carry product-specific persona/memory logic.

### `examples/companion`

The product-validation surface (the "Amadeus-like" target, unbranded for now —
see Phase 3 Decisions). Built and live (https://charivo-companion.vercel.app/).
Memory, relationship state, character catalog, and the memory eval live here in
the app layer, built extraction-ready so a stable memory mechanism can later
graduate to a thin core package. Persona depth (Phase 4), turn UX, reconnect
behavior, and memory experiments iterate here first.

### `@charivo/realtime/openai-agents`

Transport boundary with the OpenAI Agents SDK. Keep transport concerns here.

### `@charivo/realtime`

Owns normalized realtime state, tool registry, session config, and future hooks
that product work may depend on.

### `@charivo/render`

Bridges realtime avatar actions into renderer behavior.

### `@charivo/render-live2d`

Defines the lower bound of expressiveness. If gaze, idle behavior, or motion
layering need new public affordances, this is where they surface.

### App And Server Layers

Persona, memory storage, user profile logic, session archives, and privacy
policy should start here, not in core packages.

## Anti-Goals

- do not redesign Charivo into an Amadeus-specific architecture
- do not collapse the event bus and event emitter contracts
- do not put unstable persona or memory models into core packages prematurely
- do not treat a single prompt as the full solution to character quality
- do not confuse roadmap status with a line-by-line engineering backlog

## v1 Definition

It is reasonable to call the project "Amadeus v1" once all of the following are
true:

- realtime voice conversation meets the baseline defended in Phase 0
- expression, motion, and gaze behavior pass the Phase 1 quality bar
- interruption and reconnect behavior meet the Phase 2 UX bar
- cross-session memory works with measured precision from Phase 3
- character tone clears the persona evaluation bar from Phase 5

**Declared: v1 (2026-06-04).** This is the product milestone for the companion
(the criteria above) — a quality bar, not a package version. It is recorded here,
not as a git/npm version tag: the companion stays private at its own version
(`0.1.0`) and the `@charivo/*` packages stay independently versioned via
changesets. All criteria are met: realtime voice and avatar
expression/motion/gaze confirmed by direct demo observation; interruption /
reconnect and cross-session memory precision pass deterministically (the
`realtime-core` contract test and `eval:memory`); persona tone cleared a fresh
advisory eval. (The `pnpm test:voice` latency smoke had briefly gone red from a
Chromium fake-mic timing race — the canned WAV played once and finished before
the session went active; fixed 2026-06-04 by looping the fixture so server VAD
hears the turn. It now passes: baseline ~3690ms, e2e ~2523ms with live avatar
tool calls.)

## Note

If this project moves toward public release, IP, asset licensing, and
voice-similarity risk must be treated as first-class product constraints from
the beginning.
