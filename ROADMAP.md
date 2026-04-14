# Amadeus Roadmap

Created: 2026-04-14

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

- Keep the current layering: `@charivo/core -> *-core -> browser client/player/transcriber/renderer -> provider`
- Keep the current event split: `RenderManager.setEventBus(...)` and realtime/TTS/STT managers using `setEventEmitter(...)`
- Let OpenAI handle agent/runtime concerns while Charivo handles character state, rendering, and orchestration
- Prefer adapters and feature expansion over large architectural redesigns
- Assume realtime input transcription is handled by the OpenAI Agents SDK; standalone STT (`@charivo/stt-*`) is not on the Amadeus path until proven necessary

## What Already Exists

The repository already has most of the foundation needed for an Amadeus prototype.

- `@charivo/realtime-client-openai-agents` provides an OpenAI Agents SDK based realtime transport
- `@charivo/realtime-core` already has typed session config, a tool registry, and reconnect-based `updateSession(...)`
- `@charivo/render-core` already bridges realtime emotion and lip-sync events into the renderer
- `@charivo/render-live2d` already exposes expression, motion, lip-sync, and mouse tracking primitives
- `examples/web` is already the fastest place to validate the full realtime voice path in a real app

In practice, the project is already close to a "talking Live2D character."
What is missing is the layer that makes it feel like Amadeus instead of a generic demo.

## Core Gaps

There are five major gaps to close.

### 1. Avatar control is still too narrow

Current realtime avatar control is effectively centered on `setEmotion`.
An Amadeus-like character needs at least:

- `setExpression`
- `playMotion`
- `lookAt` or gaze targeting
- `setIdleMode` or an equivalent idle-state switch

### 2. Realtime conversation state is still shallow

The current stack is good at session transport and streaming output, but weaker at product-level conversation handling.
Transcript shape, interruption recovery, and session summaries need to be treated as part of the UX, not just transport details.

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

The goal is to move from "a character with emotion tags" to "a character that acts."

Priority:

1. expand the realtime tool and event surface
2. expand how `render-core` interprets those events
3. confirm which renderer primitives need to be exposed or refined

Work items:

- add `setExpression`, `playMotion`, `lookAt`, and `setIdleMode` next to `setEmotion`
- extend the built-in realtime tool concept from emotion-only control to avatar action control
- keep the mapping between tools/events and renderer capabilities loose rather than renderer-specific
- preserve the event split: `realtime-core` keeps emitting via `setEventEmitter(...)`, `render-core` keeps consuming via `setEventBus(...)`; new actions must not collapse the two contracts
- define precedence when message emotion tags and explicit realtime avatar actions disagree, and locate that decision in `render-core` (the consumer side) rather than in `realtime-core`
- add basic rate limiting or debounce rules to avoid motion/expression spam

Recommended package scope:

- `@charivo/core`
- `@charivo/realtime-core`
- `@charivo/render-core`
- `@charivo/render-live2d`

Done when:

- one live session can drive expression, motion, and gaze changes
- avatar reactions stay aligned with the spoken/text response
- noisy over-animation is reduced

### Phase 2. Solidify The Realtime Conversation UX

The goal is to turn realtime support from a technical feature into a sustainable conversation experience.
Phase 2 is strictly about *within a single session*. Cross-session persistence belongs to Phase 3.

Work items:

- shape realtime transcript data into a conversation log that is readable to users
- distinguish assistant draft output, final utterances, and interruption artifacts
- define what in-session state should survive a reconnect inside the same session
- evaluate where `updateSession(...)` is acceptable and where reconnect cost hurts UX
- keep the in-session transcript shape clean enough that Phase 3 can consume it as a summarization input

Recommended work areas:

- `@charivo/realtime-core`
- `@charivo/realtime-client-openai-agents`
- app-level store and UI

Done when:

- users can naturally understand what was said during the session
- reconnects and interruptions can be recovered without losing the overall interaction
- long sessions do not collapse into transcript chaos

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

- measure latency, interruption recovery, transcript quality, and memory precision
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

## Package-Level Map

### `examples/web`

This should be the first place to experiment.
It is the right environment for validating the Amadeus app UX quickly.

### `@charivo/realtime-client-openai-agents`

This is the key boundary between the OpenAI Agents SDK and the Charivo transport contract.
It is the most likely place for richer event support, session update capability, and transcript refinement work.

### `@charivo/realtime-core`

This should remain the center of the tool registry, session state, transcript normalization, and future memory integration hooks.
Most Amadeus-specific framework expansion will likely begin here.

### `@charivo/render-core`

This is the right place to interpret realtime avatar actions and bridge them into renderer primitives.
It will likely own the next step beyond emotion-only rendering behavior.

### `@charivo/render-live2d`

This determines the lower bound of avatar expressiveness.
If gaze control, idle behavior, or motion blending become important, this package will need public-surface review.

### App And Server Layers

Memory storage, user profiles, session archives, and privacy policy should start outside core.
That work is closer to productization than to framework design.

## Immediate Next Steps

The most reasonable sequence from here is:

1. build an "Amadeus spike mode" on top of `examples/web`
2. define the non-emotion avatar action requirements concretely
3. write the Phase 1 tool and event design before coding it
4. implement the smallest useful version of expression, motion, and gaze support
5. keep memory experimental at the app layer before trying to generalize it into core

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
