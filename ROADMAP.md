# Amadeus Roadmap

Created: 2026-04-14
Updated: 2026-04-20

## Goal

Charivo is the framework. Amadeus is the first product built on top of it.
This roadmap is about the Amadeus product, not about reshaping Charivo.

The goal is to build an Amadeus-like experience from `Steins;Gate 0` on top of Charivo.

This is not just a voice chatbot. The target is a persistent conversational character that combines:

- realtime voice conversation
- Live2D-driven expressions, motion, and gaze
- a stable character profile and relationship continuity
- memory across sessions
- response quality and operational stability over long-term use

## Assumptions

This roadmap assumes the current Charivo architecture stays intact.

- Keep the current layering: `@charivo/core -> modality root packages -> browser subpath adapters -> server providers`
- Keep the current event split: `RenderManager.setEventBus(...)` and realtime/TTS/STT managers using `setEventEmitter(...)`
- Let OpenAI handle agent/runtime concerns while Charivo handles character state, rendering, and orchestration
- Prefer adapters and feature expansion over large architectural redesigns
- Assume realtime input transcription is handled by the OpenAI Agents SDK; standalone STT (`@charivo/stt`) is not on the Amadeus path until proven necessary

Execution backlog for the next concrete work lives in [`TODO.md`](./TODO.md).
This file should stay focused on phase status, major open questions, and
product-level direction.

## What Already Exists

The repository already has most of the foundation needed for an Amadeus prototype.

- `@charivo/realtime/openai-agents` provides an OpenAI Agents SDK based realtime transport
- `@charivo/realtime` already has typed session config, a tool registry, and reconnect-based `updateSession(...)`
- `@charivo/realtime` already exposes canonical avatar control tools for expression, motion, and gaze
- `@charivo/render` already bridges realtime avatar action and lip-sync events into the renderer
- `@charivo/render-live2d` already exposes expression, motion, lip-sync, and mouse tracking primitives
- `examples/web` is already the fastest place to validate the full realtime voice path in a real app

In practice, the project is already close to a "talking Live2D character."
What is missing is the layer that makes it feel like Amadeus instead of a generic demo.

## Core Gaps

There are five major gaps to close.

### 1. Avatar control is still too narrow

Current realtime avatar control needs to be centered on canonical avatar
actions rather than semantic shorthands. An Amadeus-like character needs at
least:

- `setExpression`
- `playMotion`
- `lookAt` or gaze targeting
- `setIdleMode` or an equivalent idle-state switch

### 2. Realtime conversation state is still shallow

The current stack is good at session transport and streaming output, but weaker at product-level conversation handling.
Turn-state clarity, interruption recovery, reconnect behavior, and session summaries need to be treated as part of the UX, not just transport details.

### 3. There is no memory layer yet

The defining feature of Amadeus is continuity.
The current repo supports live interaction well, but long-term memory and recall still need to be designed separately.

### 4. There is no character state model yet

Amadeus should not always respond in the exact same tone.
Relationship level, topic, time, emotional context, and conversational fatigue should all affect behavior.
That requires more than a static persona prompt.

### 5. There is no evaluation or operating baseline yet

An Amadeus system has to hold up over time.
Latency, interruption recovery, tool misuse, memory hallucination, and overactive motion/expression behavior all need measurable standards.

## Phased Roadmap

### Phase 0. Lock The Product Concept And Establish A Baseline

The goal is to stop being abstract about the target.
`examples/web` already runs a realtime voice path with a Live2D avatar, so this phase is about *measuring what already exists*, not building a new spike from scratch.

Work items:

- Write down a concrete product definition for this Amadeus project
- Lock the first target platform to web
- Decide the Live2D model strategy, voice direction, naming policy, and how directly the project should reference the source material
- Use `examples/web` as the baseline harness and confirm the OpenAI Agents realtime path is the default
- Measure baseline latency, interruption recovery, and lip-sync quality on the current build before changing anything

Deliverables:

- a short product concept doc
- a baseline measurement note (latency / interruption / lip-sync) captured against the current `examples/web`
- an initial checklist of acceptance thresholds to defend in later phases

Done when:

- baseline numbers exist for response start time, interruption recovery, and lip-sync stability
- the team agrees those numbers are the floor that later phases must not regress

### Phase 1. Expand Avatar Expressiveness

The goal is to move from "a character that speaks" to "a character that acts."

Status:

- framework-side avatar control foundation is now in place in Charivo
- canonical realtime avatar primitives are `expression`, `motion`, and `gaze`
- the legacy `emotion` compatibility layer has been removed rather than retained
- `examples/web` already demonstrates realtime expression, motion, gaze, and debug visibility
- generic realtime prompting now keeps product-specific acting guidance in the
  app layer rather than growing the library default prompt
- recent prompt tuning keeps `expression`, `motion`, and `gaze` active in live
  evaluation while pushing lightweight reactions toward gaze and reducing
  spoken tool/action leakage
- remaining work is now mostly product-side behavior tuning and future follow-up items, not basic framework plumbing

Priority:

1. expand the realtime tool and event surface
2. expand how `render-core` interprets those events
3. confirm which renderer primitives need to be exposed or refined

Work items:

Completed in Charivo foundation:

- add `setExpression`, `playMotion`, and `lookAt` as the canonical realtime avatar actions
- extend the built-in realtime tool concept to avatar action control
- keep the mapping between tools/events and renderer capabilities loose rather than renderer-specific
- preserve the event split: `@charivo/realtime` keeps emitting via `setEventEmitter(...)`, `@charivo/render` keeps consuming via `setEventBus(...)`
- add basic rate limiting or debounce rules to avoid motion/expression spam
- remove the old `emotion` shorthand path instead of carrying it forward as a long-term control surface

Still open for this phase or immediate follow-up:

- decide whether `setIdleMode` is actually needed as a first-class primitive or whether idle should remain renderer/state driven
- keep tuning prompting and tool descriptions against the actual Amadeus target instead of only the framework demo
- define whether non-realtime responses should ever drive avatar actions, and if so through what explicit contract
- validate the current avatar action UX against the actual Amadeus target instead of only the framework demo

Recommended package scope:

- `@charivo/core`
- `@charivo/realtime`
- `@charivo/render`
- `@charivo/render-live2d`

Done when:

- one live session can drive expression, motion, and gaze changes
- avatar reactions stay aligned with the spoken/text response
- noisy over-animation is reduced

Current read:

- the framework portion is substantially done
- Amadeus-specific polish for when and why actions are used is still open

Follow-up after Phase 1:

- design a separate turn-based avatar action contract or tag/tool-like pass if non-realtime responses should drive avatar actions again

### Phase 2. Solidify The Realtime Conversation UX

The goal is to turn realtime support from a technical feature into a sustainable conversation experience.
Phase 2 is strictly about *within a single session*. Cross-session persistence belongs to Phase 3.

Work items:

- define how assistant live draft, final utterances, and interruption artifacts appear during a realtime turn
- define what in-session state should survive a reconnect inside the same session
- evaluate where `updateSession(...)` is acceptable and where reconnect cost hurts UX
- keep in-session turn data clean enough that Phase 3 can consume it as summarization input when needed

Recommended work areas:

- `@charivo/realtime`
- `@charivo/realtime/openai-agents`
- app-level store and UI

Done when:

- users can naturally understand what was said during the session
- reconnects and interruptions can be recovered without losing the overall interaction
- long sessions do not collapse into confusing partial drafts or stale turn state

### Phase 3. Introduce A Memory Layer

The goal is to create continuity across sessions.

Memory should be split into at least three layers:

- short-term memory: recent turns and live session state
- medium-term memory: user facts and conversation summaries that should persist for days
- long-term memory: relationship changes, important events, preferences, boundaries, and recurring themes

Work items:

- define a memory schema first
- define summary generation and memory handoff rules for long or ended sessions (the cross-session half of what Phase 2 deliberately left out)
- extract summaries and candidate facts at the end of conversations
- insert a validation step before promoting data into long-term memory
- define retrieval rules for which memories are injected into the next session
- store facts, guesses, and relationship state separately
- define how memory accuracy will be measured (precision of facts written, rate of incorrect writes, recall of relevant memories) — this measurement methodology is itself a Phase 3 deliverable so Phase 5 does not have to reinvent it

Recommended implementation direction:

- start storage in the app/server layer and only introduce a core abstraction when the shape is stable
- avoid letting the agent directly write everything into memory without a second filtering step

Done when:

- the system can remember names, preferences, and recent context across sessions
- incorrect memories can be corrected or deleted
- false-memory accumulation is constrained
- there is a documented method for measuring memory precision and incorrect-write rate

### Phase 4. Build The Amadeus Persona And State Model

The goal is to make the system feel specifically like Amadeus, not just like a memory-enabled assistant.

Work items:

- lock a baseline persona prompt
- separate relationship stage, situational mode, and response tone into explicit state
- vary expression intensity, question style, and recall behavior based on relationship state
- define rules for prohibited topics, uncertainty handling, and emotional overreaction
- add mode-transition tools or internal state transition rules if needed

Example states (illustrative only — the actual set should be defined at the start of Phase 4):

- `baseline`
- `focused`
- `gentle`
- `concerned`
- `reflective`
- `low_energy`

Done when:

- the same question can produce meaningfully different tones depending on context and relationship state
- character consistency no longer depends only on a few prompt paragraphs
- tone drift over long conversations is reduced

### Phase 5. Evaluation, Operations, And Public Readiness

The goal is to move from a personal prototype to a system that can be used repeatedly with confidence.

Work items:

- measure latency, interruption recovery, turn clarity, and memory precision
- create a persona consistency evaluation set
- log tool misuse and motion spam
- define data retention, deletion, and export behavior
- review licensing and rights issues around assets, character likeness, and voice similarity before any public release

Operational checklist:

- session failure rate
- average response start time
- interruption recovery success rate
- incorrect memory write rate
- collected examples of persona collapse

Done when:

- there are repeatable evaluation scenarios
- regressions can be detected
- there is a minimum bar for deciding whether public release is responsible

## How To Use This Roadmap

This file should be treated as a phase and milestone document, not as a
day-to-day task list.

Use it to track:

- what has been completed at the phase level
- what remains open at the product level
- which risks or design questions block the next phase

Do not use it to track:

- small implementation chores
- cleanup-only commits
- line-by-line engineering TODOs

For day-to-day execution, use issues, PRs, or a separate working checklist.
The roadmap should stay readable as a high-level progress document.
For shared agent and session handoff, use [`TODO.md`](./TODO.md).

## Package-Level Map

### `examples/web`

This should be the first place to experiment.
It is the right environment for validating the Amadeus app UX quickly.
It is the most likely place for richer event support, session update
capability, and turn-UX refinement work.

### `@charivo/realtime/openai-agents`

This is the key boundary between the OpenAI Agents SDK and the Charivo transport contract.

### `@charivo/realtime`

This should remain the center of the tool registry, session state, normalized turn events, and future memory integration hooks.
Most Amadeus-specific framework expansion will likely begin here.

### `@charivo/render`

This is the right place to interpret realtime avatar actions and bridge them into renderer primitives.
It will likely own the next step beyond emotion-only rendering behavior.

### `@charivo/render-live2d`

This determines the lower bound of avatar expressiveness.
If gaze control, idle behavior, or motion blending become important, this package will need public-surface review.

### App And Server Layers

Memory storage, user profiles, session archives, and privacy policy should start outside core.
That work is closer to productization than to framework design.

## Things To Avoid

The following choices are likely mistakes at this stage:

- redesigning Charivo into an Amadeus-specific architecture
- putting Amadeus-specific code (persona, memory schema, character state) inside `@charivo/*` core packages — that work belongs in the Amadeus app/server layer
- collapsing the event bus and event emitter contracts into one abstraction
- overhauling transport internals before the memory problem is even defined
- trying to solve character quality entirely with a single prompt

## v1 Definition

It is reasonable to call the project "Amadeus v1" once all of the following are true:

- realtime voice conversation meets or beats the Phase 0 baseline thresholds
- expression, motion, and gaze reactions exist and pass the Phase 1 over-animation checks
- basic user facts and recent context persist across sessions, with memory precision measured by the Phase 3 methodology and within an agreed bound
- interruption and reconnect behavior do not regress against the Phase 0 baseline
- character tone clears the persona consistency evaluation set defined in Phase 5 at an agreed pass rate

## Note

If this ever moves toward public release, IP, model asset licensing, and voice similarity risk need to be treated as first-class concerns from the beginning.
The requirements for private experimentation and public distribution are not the same.
