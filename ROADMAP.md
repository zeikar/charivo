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

Decisions:

- `setIdleMode` stays **renderer/state-driven; not a primitive** (decided
  2026-05-29). Idle is fallback filler behavior (the Live2D renderer auto-plays
  a random `Idle`-group motion at lowest priority when nothing else is running),
  semantically distinct from the directed `setExpression` / `playMotion` /
  `lookAt` actions — exposing it as a per-turn tool would mis-model it, and
  there is no demand (no demo control, no request) to justify the core-event +
  tool + renderer surface a primitive would add. If a concrete need ever appears
  (e.g. "freeze the avatar mid-conversation"), expose it as session config
  (`enableIdleFallback`-style), not a per-turn tool; the current implementation
  is isolated, so adding it later is cheap and non-breaking.

What is still open:

- validate whether the current action mix actually feels like Amadeus rather
  than a generic demo
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
Substantially complete; exit criteria met (2026-05-29). Remaining reconnect-UX
polish is deferred as optional — revisit only if real usage shows friction.

What is done:

- live draft, final utterance, and interruption artifacts are surfaced in
  `examples/web` (a "Live" draft bubble, final bubbles, an "Interrupted" bubble,
  and a Stop button that drives `RealtimeManager.interrupt()`)
- reconnect-visible state is intentional: a `Reconnecting` indicator plus the
  documented interrupted-on-reconnect contract (in-flight responses are marked
  interrupted and not resumed; the next fresh turn clears it)
- long sessions no longer accumulate stale turn state: the openai-agents client
  caches only the latest assistant text instead of retaining full SDK history

Deferred (optional, beyond the exit bar):

- finer reconnect/session-refresh UX polish (e.g. richer draft visibility during
  reconnect). The interrupted-on-reconnect contract is recorded in
  [docs/baseline.md](docs/baseline.md); revisit only if real usage shows friction

Exit criteria (met):

- partial drafts, final utterances, and interruption artifacts are clear to the
  user
- reconnect-visible state is intentional rather than incidental
- long sessions do not accumulate stale or confusing turn state

### Phase 3. Memory

Goal:
Create continuity across sessions.

Status:
Not started. Architecture decided (2026-05-29); design/implementation next.

Decisions (2026-05-29):

- **Memory lives in the product app/server layer, not `@charivo/*` core.** A
  generic `@charivo/memory` is plausible long-term (it fits the existing
  pluggable-manager idiom — `MemoryManager(memoryStore, …)` like the realtime /
  TTS / STT managers), but building it before any real usage would lock in a
  wrong contract on a published package. Build it concretely in the app first,
  **extraction-ready** (a clean internal `MemoryStore`-style boundary), and
  graduate the stable mechanism to a thin core package only once a second
  consumer or a clearly product-agnostic shape appears.
- **Injection uses the existing seam, no core change:** retrieved memory is fed
  in via `startSession({ instructions })` (the same place product persona /
  acting guidance is composed) and optionally refreshed via `updateSession(...)`.
  Writes happen app-side on session end / salient events, filtered — the model
  never writes long-term memory directly.
- **Product surface = a new `examples/companion` app** (monorepo sibling), not
  `examples/web`. `examples/web` stays the minimal framework demo; `companion`
  carries product persona / memory / relationship state. The product name/brand
  is intentionally deferred (generic `companion`) until this graduates to its
  own standalone repo at release stage (Phase 5+). Add `companion` to the
  changeset `ignore` list so it is never published.

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

Phases 0–2 are complete (Phase 1 is substantially complete; its `setIdleMode`
question is decided). The near-term priority is now Phase 3 (Memory): cross-
session continuity.

Current focus areas:

- design the memory schema (short/medium/long-term layers)
- define promotion rules (summaries, facts, relationship updates) and retrieval
  rules for what gets injected into future sessions
- include a correction/deletion path from the start
- build it in the app/server layer first, not in core packages

## Package Map

### `examples/web`

Minimal framework demo — the reference for "how to use Charivo." Kept lean; it
does not carry product-specific persona/memory logic.

### `examples/companion` (planned)

The product-validation surface (the "Amadeus-like" target, unbranded for now —
see Phase 3 Decisions). Memory, persona, relationship state, and session
archives live here in the app/server layer, built extraction-ready so a stable
memory mechanism can later graduate to a thin core package. Turn UX, reconnect
behavior, memory experiments, and persona iteration become visible here first.

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
