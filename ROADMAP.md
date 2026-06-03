# Amadeus Roadmap

Created: 2026-04-14
Updated: 2026-06-03

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

A cross-session memory model with promotion rules, a typed relationship-state
model, and a precision-first memory eval now exist in `examples/companion`
(Phase 3). The persona model (Phase 4) and the evaluation + readiness surface
(Phase 5) are now in place as well:

- persona where tone and recall vary by relationship state (p4-02 / p4-03), no
  longer a single prompt paragraph
- evaluation breadth beyond memory precision — persona consistency and
  tool-misuse evals — plus an explicit release-readiness bar

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
Complete (2026-06-03). Memory shipped in `examples/companion`: extraction,
policy filter, merge (ADD/UPDATE/DELETE/NOOP), promotion, scored retrieval,
typed relationship state, and instruction injection — plus a deterministic,
precision-first memory eval harness (`pnpm --filter companion eval:memory`,
8 scenarios + a broken-extraction sensitivity check; see
[docs/history/memory-eval-2026-05.md](docs/history/memory-eval-2026-05.md)).

One design decision shifted in implementation: persistence landed as a
**browser-local `LocalStorageMemoryStore`** (per-browser continuity) rather than
the originally planned server-side SQLite. The `MemoryStore` boundary is
preserved, so a server-side SQLite/Postgres + `pgvector` backend remains a
later drop-in. The decisions below are kept as the design record.

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

Design decisions (2026-05-29):

- **Scope = `userId + characterId`.** Both scope keys exist on every record from
  day one so multi-character continuity needs no migration; the MVP runs a
  single local user with no auth (`userId` is a local placeholder).
- **Persistence = server-side SQLite + in-memory cosine retrieval**, hidden
  behind the `MemoryStore` boundary so a Postgres + `pgvector` backend is a
  later drop-in. No vector database is introduced early.
- **Write trigger = session end + periodic checkpoint** (every N turns / salient
  events), with idempotent upserts so an abnormal end (tab close, reconnect
  failure) does not lose the session's memory.
- **Relationship state is typed, not free text** (`rapport`, `sessionCount`,
  `lastSeenAt`, `addressStyle`, `flags`), kept in its own table separate from
  facts — cheaper to inject and easier to evaluate.
- **No sensitive-data filter in the MVP.** Everything is allowed; the extraction
  pipeline keeps a `policyFilter` seam that passes through for now so a privacy
  policy can be added later without reshaping the pipeline.
- **Phase 5 regression gate is precision-first.** A wrong memory hurts a
  companion more than a missed one, so extraction/merge/injection stay
  conservative (higher importance threshold, `NOOP` on ambiguous merges, narrow
  top-K) and precision is the primary gate metric.
- **Correction/deletion in the MVP = data model + voice-delete detection.**
  Corrections are soft (`invalidAt` / `supersededBy`, never destructive); a
  spoken "forget that" is detected in the post-session extraction step and
  queued as a supersede (the model never writes long-term directly). A
  user-facing memory editor UI is deferred.

Required outputs:

- a memory schema split at least into short-term, medium-term, and long-term
  layers
- promotion rules for summaries, facts, and relationship updates
  (note: session summarization is deferred — the MVP ships facts + relationship
  promotion; the schema/render pipeline supports summaries, but no LLM
  summarizer exists yet, so they are always null)
- retrieval rules for what gets injected back into future sessions
- a correction/deletion path so bad memory can be repaired

Implementation bias:

- start in the app/server layer
- avoid pushing unstable memory abstractions into core too early
- do not let the agent write directly to long-term memory without filtering

Exit criteria (met):

- the system can remember recent context and user facts across sessions
  (browser-local, per-browser)
- incorrect memories can be corrected (soft `invalidAt` / `supersededBy`
  supersede, plus spoken-retraction detection in post-session extraction)
- memory precision can be measured (the precision-first eval harness)

### Phase 4. Persona And State Model

Goal:
Make the system feel specifically like Amadeus rather than like a memory-backed
assistant.

Status:
Done (2026-06-03). Relationship- and situational-state guidance shipped in
`examples/companion`: the longitudinal relationship block (rapport / session
cadence / address style) is injected into the live session and deepened into
explicit directives — restraint at low rapport, proactive recall when warm,
"first meeting" vs "it's been a while" framing — plus an ungated situational
date/time block and explicit prohibited-overreaction / uncertainty / restraint
rules, all locked by deterministic mapping tests. The first exit criterion (the
same topic varies by relationship + situational state) is substantially met. The
second — character consistency not resting on a single prompt paragraph — is also
met: structured persona shipped (`persona.ts`; Hiyori and Yuki populated with
invariant `voice`/`values` fields and state-conditional hooks), replacing the
single `personality` string with typed invariant traits + state-conditional
guidance injected at both realtime compose sites.

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
Complete. All five evaluation surfaces exist: the precision-first memory eval
([docs/history/memory-eval-2026-05.md](docs/history/memory-eval-2026-05.md)), the
advisory persona-consistency model-feel eval
([docs/history/persona-eval-2026-06.md](docs/history/persona-eval-2026-06.md)),
the live voice-latency / interruption smoke coverage, and the Tier-1
deterministic tool-misuse eval
([docs/history/avatar-tool-misuse-eval-2026-06.md](docs/history/avatar-tool-misuse-eval-2026-06.md)).
The release bar ([docs/release-bar.md](docs/release-bar.md)) is written. A full
IP / asset / voice-similarity review is deferred to a public-release decision
(see the Note below): the current demo is non-commercial and attributes its
bundled assets, and the release bar makes that review a precondition of any
public or commercial release.

Required outputs:

- repeatable evaluation scenarios for latency, interruption recovery, memory
  precision, tool misuse, and persona consistency (all exist)
- a minimum operating bar for release decisions
  ([docs/release-bar.md](docs/release-bar.md))
- explicit review of IP, asset licensing, and voice-similarity risk (deferred to
  a public-release decision; gated by the release bar as a precondition — see the
  Note)

Exit criteria (met):

- regressions are detectable (memory, persona, tool-misuse, and latency evals)
- release decisions can be justified against explicit criteria
  ([docs/release-bar.md](docs/release-bar.md))

## Immediate Focus

Phases 0–5 are complete. Phase 4 shipped the structured persona (invariant
traits + state-conditional guidance in `persona.ts`, p4-03) on top of
relationship/situational state (p4-02). Phase 5 closed the evaluation surface
(memory, persona, tool-misuse, and latency/interruption evals) and the release
bar; a full IP / asset / voice-similarity review is deferred to a public-release
decision, gated by that bar.

The roadmap's phase work is done; what remains is a v1 release decision, run
against the [release bar](docs/release-bar.md) and the v1 Definition section
below.

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

## Note

If this project moves toward public release, IP, asset licensing, and
voice-similarity risk must be treated as first-class product constraints from
the beginning.
