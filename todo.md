# Realtime Agent TODO

Shared implementation checklist for upgrading Charivo's realtime stack from a
thin WebRTC relay into a stateful realtime agent flow.

## Goal

Make realtime mode character-aware, tool-extensible, stateful, and usable as a
first-class conversation path alongside the existing LLM/TTS/STT flow.

## Constraints

- Preserve the current layering:
  `@charivo/core` -> `*-core` managers -> browser clients/renderers -> server routes/providers
- Keep the event split intentional:
  `RenderManager` uses `setEventBus(...)`, realtime uses `setEventEmitter(...)`
- Do not collapse package boundaries
- Keep docs aligned with actual behavior
- Run `pnpm verify` for repo-wide validation
- Run `pnpm build:web` when demo app behavior changes
- Add a changeset only if a publishable package changes in a way that should ship

## Current Gaps

- `@charivo/realtime-core` mostly relays client events and does not own rich session state
- realtime session config is not character-aware
- tool handling is effectively hardcoded around `setEmotion`
- demo UI does not treat realtime as a full turn-based conversation stream
- realtime events are too thin for robust UX and debugging

## Recommended Order

1. Add richer realtime types and events in `@charivo/core`
2. Make `@charivo/realtime-core` stateful and character-aware
3. Generalize tool execution instead of special-casing `setEmotion`
4. Expand `@charivo/realtime-client-openai` event handling
5. Update `examples/web` to use realtime as a real agent session
6. Backfill tests and docs

## TODO

### Phase 1: Core Types And Contracts

- [x] Extend `packages/core/src/types.ts` with explicit realtime state types
- [x] Add turn/session concepts such as connection state, response state, and last error
- [x] Add richer realtime events for UI and render integration
- [x] Keep current event split intact while extending the event map

Candidate events:

- [x] `realtime:session:start`
- [x] `realtime:session:end`
- [x] `realtime:state`
- [x] `realtime:user:transcript`
- [x] `realtime:assistant:start`
- [x] `realtime:assistant:delta`
- [x] `realtime:assistant:done`
- [x] `realtime:tool:call`
- [x] `realtime:tool:result`

Definition of done:

- [x] Types are documented and exported from `@charivo/core`
- [x] Existing non-realtime packages still compile without contract breakage

### Phase 2: Character-Aware Session Config

- [x] Add a realtime session builder in `@charivo/realtime-core` that accepts `Character`
- [x] Compose session instructions from character identity, personality, voice, and realtime defaults
- [x] Preserve current `getEmotionSessionConfig(...)` behavior or replace it with a clearly documented superset
- [x] Keep `setEmotion` support as a default capability, not the only capability

Definition of done:

- [x] Realtime session startup can derive config from character data
- [x] Demo no longer hardcodes only `model` and `voice`

### Phase 3: Stateful Realtime Manager

- [x] Expand `packages/realtime-core/src/realtime-manager.ts`
- [x] Store session state inside the manager instead of only booleans
- [x] Add `setCharacter(...)`
- [x] Add `getState()`
- [ ] Add `updateSession(...)` or equivalent config refresh API
- [x] Add `interrupt()` support for cancelling the current assistant turn
- [x] Emit richer lifecycle events through the existing emitter bridge
- [x] Decide how partial assistant text is accumulated and finalized

Definition of done:

- [x] Manager exposes enough state for UI without reaching into the client
- [ ] Manager can be reused across reconnects and character changes

### Phase 4: Tool Registry And Execution Flow

- [x] Replace hardcoded tool handling with a registry-based approach
- [x] Support registering tool handlers by name
- [x] Keep `setEmotion` as the first built-in tool implemented via the registry
- [x] Return real tool outputs to OpenAI instead of always `{ success: true }`
- [x] Emit tool lifecycle events for debugging and UI visibility
- [x] Define behavior for tool failure, timeout, and malformed arguments

Definition of done:

- [x] New tools can be added without editing OpenAI client internals
- [x] Emotion handling still works through the generalized path

### Phase 5: OpenAI Realtime Client Expansion

- [x] Review `packages/realtime-client-openai/src/client.ts` event parsing coverage
- [x] Expose user transcript callbacks from input audio transcription events
- [x] Expose assistant turn start/done boundaries
- [x] Expose tool call lifecycle more explicitly
- [x] Add interruption/cancel support if available through the data channel contract
- [x] Tighten duplicate-send and in-flight response handling
- [x] Improve error normalization for server, data channel, and session bootstrap failures

Definition of done:

- [x] Client surface is rich enough for `realtime-core` to remain provider-agnostic
- [x] DOM tests cover the added event flows

### Phase 6: Demo App Integration

- [x] Update `examples/web/src/app/hooks/useRealtimeMode.ts` to pass character-aware config
- [x] Subscribe to richer realtime events from `Charivo`
- [x] Show live assistant deltas in the UI instead of only completed non-realtime messages
- [x] Show user transcript updates during voice conversations
- [x] Reflect session state, reconnect state, and tool/error state in the store
- [x] Ensure realtime mode teardown is clean when switching character or transport mode

Definition of done:

- [x] Realtime mode feels like a first-class chat path in the demo
- [x] Switching between classic and realtime mode does not leave stale state behind

### Phase 7: Tests, Docs, And Release Hygiene

- [x] Extend `packages/realtime-core/__tests__/realtime-core.test.ts`
- [x] Extend `packages/realtime-client-openai/__tests__/realtime-client-openai.dom.test.ts`
- [x] Update `packages/realtime-core/README.md`
- [x] Update `packages/realtime-client-openai/README.md`
- [x] Update root `README.md` if public behavior changes
- [x] Add changesets only for publishable package changes that should go to npm

Validation checklist:

- [x] `pnpm verify`
- [x] `pnpm build:web` if demo behavior changed
- [x] `pnpm pack:check` if package surface or release behavior changed

## Suggested First Slice

Start with a narrow vertical slice:

- [x] Add new realtime state/event types in `@charivo/core`
- [x] Add `setCharacter(...)` and `getState()` to realtime manager
- [x] Build character-aware session config in `@charivo/realtime-core`
- [x] Wire the demo to start realtime sessions from character data

This slice gives immediate product value without forcing the full tool registry
refactor in the same batch.
