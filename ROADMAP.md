# Amadeus Roadmap

Created: 2026-04-14
Updated: 2026-05-29

## Purpose

Charivo is the framework. Amadeus is the first product target built on top of
it.

This file is the single planning document for that effort. It should stay
short, phase-oriented, and readable. It is not a task dump.

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

What is still missing is product quality, not basic plumbing:

- clearer interruption and reconnect UX
- a memory model and promotion rules
- an explicit persona and relationship-state model
- evaluation thresholds that are good enough to defend regressions

## Phase Status

### Phase 0. Product Definition And Baseline

Goal:
Lock the product target and establish a baseline for the current realtime
stack.

Status:
Complete.

What is done:

- the target product direction is clear enough to guide implementation
- `examples/web` is established as the main validation surface
- voice smoke tests provide a usable latency trend signal
- the realtime stack is stable enough to treat as the baseline foundation

What is still open:

- nothing blocking; the baseline is now recorded in [docs/baseline.md](docs/baseline.md)

Exit criteria (met):

- response-start baseline is recorded (see [docs/baseline.md](docs/baseline.md))
- interruption and lip-sync expectations are stated clearly enough to compare
  future changes against them (see [docs/baseline.md](docs/baseline.md))

### Phase 1. Avatar Expressiveness

Goal:
Move from "a character that speaks" to "a character that acts."

Status:
Substantially complete at the framework level. Remaining work is product-side
tuning.

What is done:

- canonical realtime avatar primitives are now `setExpression`, `playMotion`,
  and `lookAt`
- the old emotion shorthand path has been removed
- default prompting is tuned away from expression spam and toward lighter gaze
  reactions where appropriate
- `examples/web` demonstrates live expression, motion, gaze, and avatar debug
  visibility

What is still open:

- validate whether the current action mix actually feels like Amadeus rather
  than a generic demo
- decide whether `setIdleMode` is a real primitive or should remain
  renderer/state-driven
- decide whether non-realtime paths should ever drive avatar actions again

Exit criteria:

- live sessions can drive expression, motion, and gaze reliably
- avatar actions align with the spoken response
- over-animation is reduced to an acceptable level

### Phase 2. Realtime Conversation UX

Goal:
Turn the realtime stack from a transport success into a coherent conversation
experience within a single session.

Status:
Current active phase.

Why this is next:

- draft and final transcript handling has improved
- reconnect refresh exists technically
- interruption and reconnect behavior are still not expressed cleanly enough at
  the product UX level

Primary questions:

- what should the user see during live draft, finalization, interruption, and
  reconnect
- what state should survive reconnect inside the same session
- where is `updateSession(...)` acceptable, and where does reconnect cost hurt
  the experience too much

Exit criteria:

- partial drafts, final utterances, and interruption artifacts are clear to the
  user
- reconnect-visible state is intentional rather than incidental
- long sessions do not accumulate stale or confusing turn state

### Phase 3. Memory

Goal:
Create continuity across sessions.

Status:
Not started.

Required outputs:

- a memory schema split at least into short-term, medium-term, and long-term
  layers
- promotion rules for summaries, facts, and relationship updates
- retrieval rules for what gets injected back into future sessions
- a correction/deletion path so bad memory can be repaired

Implementation bias:

- start in the app/server layer
- avoid pushing unstable memory abstractions into core too early
- do not let the agent write directly to long-term memory without filtering

Exit criteria:

- the system can remember recent context and user facts across sessions
- incorrect memories can be corrected
- memory precision can be measured

### Phase 4. Persona And State Model

Goal:
Make the system feel specifically like Amadeus rather than like a memory-backed
assistant.

Status:
Not started.

Required outputs:

- a baseline persona definition
- explicit relationship and situational state
- tone and recall behavior that vary by state
- rules for uncertainty, restraint, and prohibited overreaction

Exit criteria:

- the same topic can produce meaningfully different responses depending on
  context and relationship state
- character consistency does not depend only on a prompt paragraph

### Phase 5. Evaluation And Readiness

Goal:
Define whether the system is reliable enough to iterate on confidently, and
eventually safe enough to consider public release.

Status:
Not started.

Required outputs:

- repeatable evaluation scenarios for latency, interruption recovery, memory
  precision, tool misuse, and persona consistency
- a minimum operating bar for release decisions
- explicit review of IP, asset licensing, and voice-similarity risk

Exit criteria:

- regressions are detectable
- release decisions can be justified against explicit criteria

## Immediate Focus

The near-term priority is Phase 2, not new framework primitives.

Current focus areas:

- define interruption-visible UX in `examples/web`
- define reconnect/session-refresh expectations
- close the gap between internal realtime state and what the user actually sees
- keep Phase 0 baseline notes compact but explicit enough to anchor later work

## Package Map

### `examples/web`

Primary product-validation surface. This is where turn UX, reconnect behavior,
memory experiments, and persona iteration should become visible first.

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

## Note

If this project moves toward public release, IP, asset licensing, and
voice-similarity risk must be treated as first-class product constraints from
the beginning.
