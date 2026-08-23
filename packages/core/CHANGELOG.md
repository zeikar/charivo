# @charivo/core

## 0.32.0

### Minor Changes

- e5ea6b7: Have the manager factories return the members they always provide

  `createRealtimeManager`, `createTTSManager`, and `createSTTManager` returned the
  core interfaces, where `setEventEmitter`, `prepareAudio`, and `dispose` are
  optional — correctly so, since a third-party manager may omit them. But the
  built-in managers always implement them, and the factory's return type said
  otherwise, so every caller had to narrow a method that could not be missing.

  They now return `BuiltInRealtimeManager`, `BuiltInTTSManager`, and
  `BuiltInSTTManager`: the same interfaces with those members required. This is
  the shape `createLLMManager` has used since it started returning
  `LLMManagerWithTools`.

  Nothing is removed or renamed, and the core interfaces are untouched, so an
  implementation or a variable typed as `TTSManager` keeps working exactly as
  before.

## 0.31.0

### Minor Changes

- 21d19b3: Give motions descriptions, and stop tool-triggered motions from playing their baked-in audio

  Motions reached the model as a bare list of group names, so it chose between
  `Idle` and `TapBody` knowing nothing about either. `AvatarControlCatalog` now
  takes an optional `motionDescriptions`, keyed by group with a positional array
  per motion — `playMotion` takes a group and an index, and the index is where a
  wrong pick actually happens. The meanings ride along in the `playMotion` tool
  schema and the avatar instructions, exactly as expression descriptions do.

  Separately, Cubism sample motions can carry a prerecorded voice clip, and the
  renderer played it into the speakers — a stranger's voice over the character's
  own, and while it played its RMS drove the mouth whenever realtime lip sync was
  off. `avatar:motion` and `playMotionByGroup` now take an optional `muteSound`,
  which `@charivo/avatar`'s result projector sets on tool-call motions. A muted
  start refuses the clip, silences one already playing, and invalidates a load
  still in flight.

  Nothing changes for existing code: absent descriptions leave the tool schema
  and instructions byte-identical, and an unflagged motion stays audible, so a
  human-triggered motion keeps its sound.

### Patch Changes

- 9d9ba15: Give the remaining packages npm keywords

  Only `@charivo/tts` and `@charivo/stt` carried `keywords`, so the other seven
  published packages were reachable on npm by name alone — including `core` and
  `render-live2d`, the two anyone looking for this project would search for
  first. Each now lists five, in the shape the existing two set: `charivo`, then
  what that package actually does.

  Manifest metadata only. No code, exports, or types change.

## 0.30.0

### Minor Changes

- 03d3d46: Expose whether a reply is still expected on `RealtimeState`.

  `sendMessage` refuses while a turn is in flight, but nothing in the state said
  so. `response.status` looked like the answer and is not: it misses the stretch
  between a message going out and its reply starting to stream, so a caller that
  checked it still hit `Response already in progress` — as an exception, after the
  fact, with no way to have known.

  `RealtimeState.awaitingResponse` reports that condition. It is derived on read
  from the send lock and the response status rather than stored, the refusal reads
  the same expression, and every transition publishes through `realtime:state`, so
  the field cannot drift from the behaviour it advertises.

  It covers the response-in-progress refusal only; an inactive or reconnecting
  session is rejected on its own terms, which `session.status` and `connection`
  already report.

## 0.29.0

### Minor Changes

- 7884f77: Expose whether the character's audio is still playing on `RealtimeState`.

  `response.status` answers "is the provider still generating", and consumers kept
  reaching for it to answer "is the character still talking" — the only question
  the state object appeared to offer. Those are different questions for the entire
  tail of every turn: a response completes when the provider finishes SENDING
  audio, and playback runs on past that. Anything built on the response status is
  wrong for that whole window, and looks correct until someone barges in near the
  end of a reply.

  `RealtimeState.audioPlaying` reports the playback segment the manager already
  tracks: true from `audio.output.started` until `audio.output.ended`, and cleared
  when a session stops, fails, or reconnects. Those are the normalized transport
  events every adapter emits, so it carries no provider-specific meaning. Changes
  publish through `realtime:state` like the rest of the state.

  Consumers that reconstructed this by subscribing to `tts:audio:start` /
  `tts:audio:end` can drop that bookkeeping and read the field.

## 0.28.0

### Minor Changes

- 13c3c3b: Send the realtime output cap under its GA name, and drop the session
  `temperature` the GA API no longer accepts.

  Setting `maxTokens` on a realtime session made the session unmintable: every
  path sent it as `max_response_output_tokens`, the Realtime beta's name for it,
  and the GA API rejects that outright with
  `Unknown parameter: 'session.max_response_output_tokens'`. Nothing in the repo
  set `maxTokens` until the demos began pinning an output cap server-side, so the
  wrong name sat unexercised.

  **@charivo/core (minor)**
  - `RealtimeSessionConfig.temperature` is removed. The GA session schema has no
    `temperature` — it rejects the parameter the same way, so the field could
    only ever break a session that set it.

  **@charivo/realtime (minor)**
  - `buildRealtimeSessionConfig(...)` no longer projects `temperature`.
  - The OpenAI client's `session.update` and the dev bootstrap's client-secret
    request send `max_output_tokens`.
  - The agents adapter carries the cap through `providerData` instead of a
    `maxResponseOutputTokens` field. The SDK rebuilds `session.update` from an
    allowlist of fields it maps, so a key it does not know is dropped before it
    reaches the wire; `providerData` is spread raw into the session payload.

  **@charivo/server (patch)**
  - The OpenAI realtime provider sends `max_output_tokens` on both the WebRTC and
    the agents (client-secret) path, so a session pinning `maxTokens` mints again.

## 0.27.0

### Minor Changes

- f2ddcbe: Real request cancellation for the cascade path, and a public `charivo.interrupt()`.

  **@charivo/core (minor)**
  - `LLMClient.call` and `callWithTools` take an optional trailing
    `LLMCallOptions { signal?: AbortSignal }`. Existing implementations keep
    working unchanged — a `call(messages)` implementation still satisfies the
    contract, and a client may ignore the signal.
  - `GenerateResponseOptions.signal` carries that signal through a manager;
    `isCancelled` still only gates new work between steps.
  - Latest-wins supersession now aborts the superseded turn's in-flight LLM
    request through a per-turn `AbortController`. A client that honors the
    signal stops waiting on the provider; one that ignores it settles late and
    the stale check swallows the settlement. The superseded `userSay` still
    resolves.
  - New `charivo.interrupt()`: the cascade counterpart of
    `RealtimeManager.interrupt()`. Cuts off the in-progress turn (LLM request
    aborted, `turn:cancelled` emitted) and stops the exact TTS manager the turn
    is speaking on — mid-turn `attachTTS()` is accounted for. No precondition:
    when idle it still stops the attached TTS manager, resolves, and emits
    nothing. It does not delegate in realtime mode; use
    `getRealtimeManager()?.interrupt()` there. `turn:cancelled` now has two
    causes (supersession or `interrupt()`); its payload is unchanged.
  - New export `fetchWithTimeout` (with `DEFAULT_FETCH_TIMEOUT_MS` and
    `FetchWithTimeoutOptions`): the shared fetch wrapper with an internal
    timeout, optional external `AbortSignal` (first-wins abort-source
    classification — an external abort is rethrown as-is, never misreported as
    a timeout), and a `mapError` hook.

  **@charivo/llm (minor)**
  - `LLMManager.generateResponse` forwards `options.signal` to the client, and
    the tool loop passes the same signal to every `callWithTools` round.
  - The remote client threads the signal into its fetch, so aborting cancels
    the underlying HTTP request; the rejection is the abort reason, not a
    timeout error.

  **@charivo/tts (patch)**
  - `stop()` now also cancels a `speak()` still starting up (the pre-speech
    stop, or audio synthesis): that call resolves silently and never begins
    playback, whether or not it had already opened an audio session. A newer
    `speak()` cancels a still-starting older one the same way, and in-flight
    player stops are serialized so a late-settling stop can never tear down
    newer playback. Previously a stop landing in the startup window found
    nothing to stop and the pending `speak()` went on to start audio.

  **@charivo/stt, @charivo/realtime, @charivo/server (patch)**
  - Internal refactor: the per-package fetch-timeout helpers were replaced by
    core's shared `fetchWithTimeout`. No behavior change — messages, timeout
    values, and error mapping are preserved.

- 8dbacf9: Make `EventMap` an interface so third parties can extend it.

  `EventMap` was a closed type alias, so a package adding its own renderer or
  manager had no way to carry custom events through the Charivo event bus without
  a core change. As an interface it supports declaration merging:

  ```ts
  import "@charivo/core";

  declare module "@charivo/core" {
    interface EventMap {
      "vrm:blendshape": { name: string; weight: number };
    }
  }
  ```

  The `import` line is load-bearing: it makes the declaring file a module so the
  block augments the package. Without it, in a standalone `.d.ts`, the same block
  shadows `@charivo/core` and every other export disappears.

  Every existing usage (`keyof EventMap`, indexed access, the
  `CharivoEventBus`/`CharivoEventEmitter` signatures) compiles unchanged. The one
  observable difference: an interface has no implicit index signature, so code
  that assigned `EventMap` to `Record<string, ...>` would now need `keyof`-based
  typing — nothing in this repo did.

### Patch Changes

- 8dbacf9: `EventBus.emit()` now iterates a snapshot of the listener list.

  It used to iterate the live array, so a listener that called `off()` during
  dispatch spliced the array and shifted the next listener out of that emit.
  `RenderManager.disconnect()` removes six listeners at once and runs on the
  `attachRenderer()` replacement path, which is exactly this shape. Listeners
  removed mid-emit still fire for that emit; the removal applies from the next
  one.

## 0.26.0

### Minor Changes

- 1cb4c27: Add `Charivo.getTTSManager()` and `Charivo.getLLMManager()`.

  `getRenderManager()`, `getSTTManager()`, and `getRealtimeManager()` already
  existed, so reading back the TTS or LLM manager was the one gap — apps had to
  keep their own reference to a manager Charivo was already holding. All five
  modalities now have a getter, each returning `undefined` when nothing is
  attached.

- 22a8f65: Add `createCharivo(options)`, and remove three unimplemented public types.

  `createCharivo` builds a `Charivo` with its managers already attached, so the
  quick-start path is one declarative call instead of `new Charivo()` followed by
  several `attach*` calls and `setCharacter()`. It brings the top-level
  orchestrator in line with the `create*` factories every other component already
  uses — `Charivo` was the only public type you instantiated with `new`.

  ```ts
  const charivo = createCharivo({
    renderer: renderManager,
    llm: createLLMManager(createOpenAILLMClient({ apiKey })),
    tts: createTTSManager(createOpenAITTSPlayer({ apiKey })),
    character,
  });
  ```

  Every option is optional, and each accepts `null` as well as `undefined`, so a
  manager held as nullable state can be passed straight through. The character is
  applied after the managers are attached, so it reaches every character-aware
  one — LLM, renderer, and realtime — without depending on call order.

  The `Charivo` class is still exported and `attach*` is unchanged, so existing
  code keeps working. The factory returns an ordinary instance, so you can supply
  what you have up front and still attach the rest later.

  **Breaking for anyone importing them:** the `Conversation`, `Plugin`, and
  `CharivoConfig` types are removed. All three were declared but never
  implemented or referenced anywhere in the codebase — `Plugin` described a
  plugin architecture that does not exist, and `CharivoConfig` described a
  provider-by-name configuration shape incompatible with the current layering.
  `CharivoOptions` is the new configuration type and is not a replacement for
  `CharivoConfig`'s shape.

## 0.25.0

### Minor Changes

- 7198359: `AvatarControlCatalog` gains an optional `expressionDescriptions?: Record<string, string>`
  so a consumer can attach a human-readable meaning to each expression ID. Previously the
  `setExpression` tool exposed expression IDs to the model as a bare `enum` with a generic
  property description, so a model whose expression IDs are opaque — the Cubism sample
  models ship IDs like `F01`..`F08` — had nothing to choose on.

  When descriptions are supplied, `@charivo/avatar` appends the meanings to the
  `setExpression` `expressionId` parameter description and to `buildAvatarControlInstructions`
  output. Keys are intersected with `catalog.expressions` and emitted in that array's order,
  so unknown or stale keys are ignored and producers can pass a config through unfiltered;
  the intersection is enforced in one place rather than at each call site. The formatter
  itself stays internal — no new exports.

  Fully backward compatible: with the field absent, or present but with no key matching an
  available expression, both the tool schema and the instruction text are byte-identical to
  before, and a model that ships no expressions still omits everything expression-related.

## 0.24.0

### Minor Changes

- e1257cf: `userSay()` is now latest-wins: calling it again while a turn is still in
  flight supersedes that turn instead of racing it. The superseded call's
  promise still resolves — it just stops short of any further turn-scoped
  effect or event, except that a tool handler already running finishes and
  still reports its `tool:result`/`tool:error` — and a new
  `turn:cancelled { userMessageId }` event fires for it exactly once,
  supersession being its only cause. Its user message is retained and lands in
  history ahead of the superseding turn's own message, regardless of which
  phase the supersession landed in; from there it is subject to the usual
  `maxHistoryTurns` eviction like any other message. Any reply the superseded
  turn was generating is dropped — a reply now only commits to history at the
  presentation boundary, after its character render and before playback, so a
  superseded turn never gets that far.
  `message:sent` also moved earlier, into the turn's entry block ahead of the
  pre-turn TTS stop, and message ids are now collision-free within an
  instance. Message validation and empty-assistant-reply handling are
  unchanged.

  Making this safe required two additions to the `LLMManager` contract:
  synchronous `addToHistory(message): HistoryRollback`, and a
  `GenerateResponseOptions` second argument to `generateResponse` with
  `callerOwnsHistory` (the manager performs no history writes for that call)
  and `isCancelled` (stops new tool work and gates every projected emission
  once it starts returning `true`). `addToHistory` is presence-idempotent by
  reference identity, rejects invalid messages with a typed `CharivoStateError`,
  and returns a handle that removes what it appended and restores what that
  call evicted, as long as nothing else has written since.

  Both are now **required** members of `LLMManager`, which only matters if you
  implement that interface yourself — the public API is factory-only
  (`createLLMManager`), so most consumers are unaffected. A custom manager
  needs to add `addToHistory` and accept the new `generateResponse` options to
  keep satisfying the interface.

  `@charivo/llm`'s built-in manager implements both. Its `addToHistory` prunes
  to the bound orphan-safely — scoped to what a given write actually evicted,
  rather than trimming blindly. Direct `generateResponse(...)` use keeps the
  append-and-prune behavior it already had, with one fix: it now rolls back by
  reference identity instead of a positional `removeLast()`, so overlapping
  direct calls no longer roll back each other's messages.

## 0.23.0

### Minor Changes

- f7caf22: `userSay()` now stops any active TTS playback at the start of a turn, before
  the LLM can project a new expression via a tool call. Previously, when a new
  turn started while the prior turn's speech was still playing, the TTS
  manager's own internal stop (inside `speak()`) would emit `tts:audio:end` for
  the OLD utterance after the new expression had already been applied, causing
  consumers that release-on-audio-end (like `@charivo/render`) to clear the new
  expression before its own speech even started. The stop is a no-op when no
  TTS manager is attached, and a failure to stop stale audio no longer aborts
  the turn — it's surfaced via the existing `tts:error` event instead.

## 0.22.0

### Minor Changes

- 0727621: Expressions set via `avatar:expression` are now released automatically
  about 8 seconds after they are applied: the model fades back to its base
  face over the expression's `FadeOutTime` (1 second when the `.exp3.json`
  does not specify one) while idle motion, eye blink, and breath keep
  running. Parameters using the `Add` or `Multiply` blend fade smoothly when
  their release duration is positive (an authored `FadeOutTime: 0` releases
  instantly); parameters using `Overwrite` snap to their base value (the SDK
  rebases overwrite values every frame). A release requested before the
  expression has finished fading in waits for the fade-in to complete before
  fading out, so an expression can remain visible beyond the nominal
  8-second hold. This is on by default when using `@charivo/render` with
  `@charivo/render-live2d`; previously an expression persisted until
  something else replaced it. The hold is a fixed internal duration — there
  is no configuration option for it yet.

  The `Renderer` interface in `@charivo/core` gains an optional
  `stopExpression()` method for releasing the active expression. If you
  implement a custom renderer, add `stopExpression()` to opt into automatic
  release; omitting it simply disables the release for that renderer.

## 0.21.0

### Minor Changes

- 75174a1: Pre-1.0 surface cleanup. Two breaking changes to the event surface, plus an additive hardening of error identification.

  **Breaking — the `EventBus` class is no longer exported.** It was never meant to be constructed by consumers; subscribe via `charivo.on(...)` / `charivo.off(...)`, or type against the `CharivoEventBus` interface if you need the shape.

  **Breaking — `character:speak` now carries its text under `text` instead of `message`** — `{ character, text }`. This resolves the naming collision with `message:sent` / `message:received`, which carry a `Message` object under `message`. Update any `character:speak` listener that reads `event.message` to read `event.text`. Note that a loosely-typed listener will not fail to compile — it will silently read `undefined` at runtime — so check every `character:speak` subscription, not just the ones the compiler flags.

  **Additive — `CharivoError` instances now carry a `Symbol.for("@charivo/core/CharivoError")` brand, and `isCharivoError` recognizes branded errors from a duplicated `@charivo/core` install** (verifying `code` is one of the known error codes and `message` is a string). Existing `instanceof CharivoError` checks keep working unchanged within a single installed copy, so no migration is required. If your app can end up with more than one copy of `@charivo/core` — a monorepo, or dependents pinned to different versions — prefer `isCharivoError(error)`, which `instanceof` cannot answer correctly across copies. The symbol brand does not survive `JSON.stringify` or structured clone (symbols are never serialized). `error.code` survives `JSON.stringify` as a plain enumerable property, but `structuredClone` and worker `postMessage` drop custom `Error` properties entirely — send an explicit `{ code, message }` envelope across those boundaries instead of relying on `error.code`.

## 0.20.0

### Minor Changes

- 666a7d4: Clean up the event contract ahead of 1.0. Four breaking changes, no back-compat aliases.
  - The unnamespaced `error` event is now `llm:error`, consistent with `tts:error`
    / `stt:error` / `realtime:error`. It still has a single emitter: the
    `LLMManager` result-projector failure path. Payload is unchanged.
  - `realtime:tool:call|result|error` are renamed to modality-neutral
    `tool:call|result|error`, and the `LLMManager` tool loop now emits them too —
    previously only realtime did, leaving the LLM tool path observably silent.
    Payloads are unchanged. `tool:result` from the LLM path carries the JSON
    snapshot of the handler result (the same value the model's tool turn
    receives), matching what realtime already emits, so the event means the same
    thing from both modalities. Note a deliberate divergence that this change does
    NOT close: LLM `resultProjectors` still receive the original validated handler
    result (so `Date`, `undefined`, and getter properties survive), while realtime
    projectors receive the snapshot. Projectors that must behave identically
    across both modalities should read only plain JSON values.
  - `stt:partial` and `stt:stop` carry their transcript under `text` instead of
    `transcription`, aligning them with `tts:start` and the realtime transcript
    and delta events. The remote STT HTTP wire shape is a separate contract and
    still uses `{ transcription }`; `STTTranscriber.onPartial`'s callback
    parameter name is also unchanged.
  - `realtime:text:delta` is removed. It was emitted back-to-back with
    `realtime:assistant:delta` carrying an identical `{ text }` payload; use
    `realtime:assistant:delta`.

- 03559a9: Give tool-result projectors the same value on every modality, and share one
  snapshot implementation between the tool runners.

  `ToolResultProjectorContext.output` now always carries the JSON snapshot of the
  handler result — the same value `tool:result` publishes and the same value the
  model's tool turn receives. `@charivo/realtime` projectors already received the
  snapshot; `@charivo/llm` projectors previously received the live handler object,
  so a `Date` survived as a `Date` there and as an ISO string on the realtime
  path. That divergence is gone: `output` means "the tool result as JSON",
  whichever modality executed the tool.

  Breaking for LLM projectors that read a value JSON cannot represent — a `Date`
  now arrives as its ISO string and an `undefined` property is absent. Such values
  were never part of what the model saw, so a projector depending on them was
  reading a side channel that only existed on one path. Projectors that read plain
  JSON values are unaffected.

  `@charivo/core` gains `snapshotToolResult(result, toolName, toolLabel?)`
  returning `{ serialized, snapshot }`, plus its `ToolResultSnapshot` type. Both
  tool runners now call it instead of each maintaining their own
  serialize/parse/re-assert sequence, so the two paths cannot drift apart again.

  `serializeToolResult` is no longer exported. It became package-internal to
  `snapshotToolResult`, which is now its only caller — callers always need the
  parsed snapshot alongside the string, so exporting the string-only half offered
  no supported use. Its behavior is unchanged; if you were calling it directly,
  use `snapshotToolResult(...).serialized`.

## 0.19.0

### Minor Changes

- 370dfdc: Share one tool-execution implementation across modalities and harden event dispatch.
  - `@charivo/core` gains the execution helpers that `@charivo/llm` and
    `@charivo/realtime` previously duplicated: `createToolRegistry()` (returning
    the new `ToolRegistry` interface), `withToolTimeout`, `serializeToolResult`,
    and `createToolFailureOutput`. Like the existing validators, each takes an
    optional `toolLabel` so thrown messages still distinguish `LLM tool` from
    `Realtime tool`; existing message strings are unchanged.
  - Realtime tool results are now serialized once inside the runner's failure
    boundary, and the parsed JSON snapshot is what reaches the transport, the
    `realtime:tool:result` event, and result projectors. A handler result that
    cannot be represented as JSON — notably one whose `toJSON()` returns
    `undefined`, which `JSON.stringify` reports without throwing — becomes a
    `{ success: false, error }` output and a `realtime:tool:error` event instead
    of reaching the transport with its `output` field silently dropped. Because
    the snapshot is taken before the transport serializes, a stateful `toJSON()`
    or getter can no longer return one value to the check and another to the
    wire. Handler results that were already plain JSON data are unaffected.
  - `EventBus.emit(...)` isolates each listener. A listener that throws is
    reported via `console.error` and no longer prevents the listeners queued
    behind it from running, so a single bad subscriber can't skip downstream
    cleanup.

## 0.18.0

### Minor Changes

- 5d949a9: Remove the deprecated `Realtime*` tool type aliases (`RealtimeTool`, `RealtimeToolContext`, `RealtimeToolHandler`, `RealtimeToolRegistration`, `RealtimeToolResultProjector`, `RealtimeToolResultProjectorContext`). Use the neutral `Tool*` contracts from `@charivo/core` instead (`ToolDefinition`, `ToolContext`, `ToolHandler`, `ToolRegistration`, `ToolResultProjector`, `ToolResultProjectorContext`); imports of the old names map 1:1 to the neutral ones. The `@charivo/realtime-avatar` package is also removed from the repo — its already-published versions keep working and continue to re-export `@charivo/avatar`.

## 0.17.0

### Minor Changes

- 87ac34f: Bring tool-based avatar control (expression / motion / gaze) to the text LLM path, sharing one tool architecture with realtime sessions.
  - New `@charivo/avatar` package: catalog-constrained avatar tool builders (`createAvatarControlTools`, `buildAvatarControlInstructions`, `createAvatarResultProjector`) depending only on `@charivo/core`, usable by both realtime and LLM sessions.
  - `@charivo/realtime-avatar` is deprecated and now re-exports `@charivo/avatar`; migrate imports (`RealtimeToolResultProjector` → core `ToolResultProjector`).
  - LLM contracts gain optional tool calling: `LLMClient.callWithTools` / `LLMProvider.generateResponseWithTools`, role-discriminated `LLMMessage`, `LLMToolCall`, `LLMToolResponse`. `LLMManager` gains a tool registry (`tools`, `resultProjectors`, `toolInstructions`, `defaultToolTimeoutMs` options plus `registerTool`/`unregisterTool`/`getRegisteredTools`/`setToolInstructions`/`setEventEmitter`) with a validated 3-round execution loop, `avatar:*` event projection, and `Charivo.attachLLM` emitter wiring. Tool turns are not persisted to history; tool-less usage is unchanged.
  - OpenAI/OpenClaw providers and the remote client implement tool calling with validated wire DTOs; the remote `/api/chat` protocol gains `tools` in the request and `toolCalls` in the response.
  - Core tool contracts generalized to neutral names (`ToolDefinition`/`ToolContext`/`ToolHandler`/`ToolRegistration`/`ToolResultProjector`) with shared `validateToolArguments`/`assertToolResultObject`; `Realtime*` tool names remain as deprecated interfaces/aliases.
  - Breaking (pre-1.0 minor): the `realtime:expression|motion|gaze` events are renamed to `avatar:expression|motion|gaze`; avatar helpers should be imported from `@charivo/avatar`.

## 0.16.0

### Minor Changes

- f54cf31: Unify lip-sync audio analysis behind one shared analyzer in `@charivo/core`.

  `createLipSyncAnalyzer` (speech-band RMS, `min(rms * 1.7, 1)`) is now the single
  implementation used by every lip-sync producer: the TTS manager analyzes the
  `<audio>` element it plays for `"audio"` playback mode, and both realtime
  clients analyze their incoming `MediaStream`. All producers emit
  `tts:lipsync:update`; `RenderManager` stays a pure consumer that toggles
  `setRealtimeLipSync` and feeds `updateRealtimeLipSyncRms` from that event — it
  no longer analyzes audio itself.

  Breaking changes:
  - `tts:audio:start` no longer carries `audioElement`; the payload is now
    `{ characterId? }`.
  - `RenderManager.prepareAudio` is removed. Use `TTSManager.prepareAudio?.()`
    and/or `RealtimeManager.prepareAudio?.()` instead, from the same
    user-gesture handler that previously called
    `renderManager.prepareAudio?.()`. With `@charivo/realtime/remote`,
    `RealtimeManager.prepareAudio?.()` needs the same `RealtimeSessionConfig`
    you pass to `startSession()` to resolve which adapter to prepare — build
    one config and pass it to both:
    `await manager.prepareAudio?.(sessionConfig);` then
    `await manager.startSession(sessionConfig);`.
  - `"audio"` playback mode now requires the `TTSPlayer` to implement
    `generateAudio()`. `createTTSManager(player)` throws an explicit error for
    an `"audio"`-mode player that lacks it, instead of silently playing without
    lip-sync. Players that only implement `speak()` (e.g. the Web Speech API)
    must use `"web-speech"` mode, whose lip-sync comes from a text-driven
    simulation.

  Also adds `TTSManager.dispose?.()` to release lip-sync audio resources for
  apps that tear a `TTSManager` down outside `Charivo.dispose()` (which already
  calls it automatically).

## 0.15.0

### Minor Changes

- 2a4656a: Add live (as-you-speak) streaming transcription to `@charivo/stt`.
  - core: an optional `STTTranscriber.onPartial` hook and a new `stt:partial`
    event (cumulative draft snapshot). Fully additive.
  - stt: a new `@charivo/stt/openai-realtime` subpath with an OpenAI Realtime
    transcription (WebRTC, `gpt-realtime-whisper`) streaming transcriber that takes
    an app-injected bootstrap. Transcript deltas stream live via `stt:partial` as
    you speak; `stopRecording()` disables the mic, sends a single commit, and
    returns the authoritative final transcript. Mid-session failures surface
    through the existing `stt:error` path. Batch transcribers are unchanged.

## 0.14.0

### Minor Changes

- f82ba6f: Add `RenderManager.setLocalGaze(coords)` — a public local-presence gaze entry point (e.g. webcam face tracking) that drives the avatar's gaze as a peer of mouse-tracking. Returns `false` while AI gaze owns the avatar or when the renderer has no `lookAt`; it suspends mouse cursor tracking (not taps) through a separate window so a local-presence driver beats the cursor while still yielding to AI gaze.

## 0.13.0

### Minor Changes

- 5a86dee: The `RenderManager` interface gains `disconnect()`, and `Charivo.detachRenderer()`/`attachRenderer()` now disconnect the (previous) manager's bus listeners.

## 0.12.0

### Minor Changes

- 8f7d277: Expose inputAudioTranscription on RealtimeSessionConfig (model + enabled)

  `RealtimeSessionConfig` now accepts an optional `inputAudioTranscription` field for controlling user-microphone transcription on the provider:
  - `inputAudioTranscription: { model: "gpt-4o-mini-transcribe" }` selects a cheaper transcription model.
  - `inputAudioTranscription: { model: "gpt-4o-transcribe" }` selects the higher-quality option.
  - `inputAudioTranscription: { enabled: false }` disables transcription entirely (useful when the UI never displays the user transcript).

  Default behavior is unchanged when the field is unset — providers continue with their existing server-side defaults. The wire shape lands under `audio.input.transcription` per the OpenAI Realtime GA contract, and applies consistently across the legacy OpenAI WebRTC client, the OpenAI Agents SDK transport, and the server provider. Model strings are pass-through; unknown values surface as upstream errors from OpenAI rather than being validated locally. Example known values: `whisper-1`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`.

## 0.11.0

### Minor Changes

- 8826f2b: Make `@charivo/realtime` session-aware and drop library-owned OpenAI defaults.

  Breaking changes:
  - `buildRealtimeSessionConfig()` no longer fills `provider` or `model`. Pass
    them explicitly on `startSession(...)` or rely on your transport client's
    local defaults.
  - `RealtimeState.session.config.provider` / `.model` may now be `undefined`
    if the caller did not specify them.

  Additive:
  - new `sessionId` threaded through `RealtimeLogger` context and `realtime:usage`
    payloads. Same id persists across `updateSession(...)` and reconnects within
    the same session.
  - logger contexts now include the active `sessionId`. If your logger already
    sets a `sessionId` field, the manager overrides it.

## 0.10.0

### Minor Changes

- 79df4cc: Make `@charivo/realtime` renderer-neutral by moving avatar-specific realtime
  tools into the new optional `@charivo/realtime-avatar` package.

  Add `RealtimeManager` result projectors and structured logger hooks, and emit
  the new `realtime:usage` core event when transport usage metadata is available.

  Breaking changes:
  - avatar tool helpers are no longer exported from `@charivo/realtime`
  - apps should import avatar realtime helpers from `@charivo/realtime-avatar`
  - avatar expression/motion/gaze events now come from configured result
    projectors rather than hardcoded tool-name handling inside `RealtimeManager`

## 0.9.0

### Minor Changes

- 7d6608f: Freeze the top-level Charivo API by adding symmetric `detachLLM()` /
  `detachRenderer()` coverage plus `dispose()`, and normalize public failures to
  typed `CharivoError` subclasses.

  Breaking change: public throws now use typed errors from `@charivo/core`
  instead of relying on generic `Error` strings. Consumers should switch from
  `error.message.includes(...)` checks to `instanceof CharivoError` or
  `error.code`.

## 0.8.0

### Minor Changes

- 3aa84ad: Improve mobile realtime resilience by adding reconnect orchestration, reconnect
  observability events, direct microphone ownership with safer browser
  constraints, and iOS-friendly audio preparation hooks.

  `@charivo/render-live2d` now handles WebGL context loss by rebuilding the host
  and reloading the last model after restore. `@charivo/stt` now requests
  browser-safe microphone constraints by default.

## 0.7.0

### Minor Changes

- c2e1cb8: Add canonical avatar control support with expression, motion, and gaze events/tools, and remove the legacy emotion-based avatar control surface.

## 0.6.0

### Minor Changes

- ec19d59: Add an OpenAI Agents SDK based realtime client, switch the default remote
  OpenAI WebRTC adapter to the new agents path, and extend realtime session
  bootstrap contracts to support ephemeral client secrets alongside legacy SDP
  bootstraps.

## 0.5.0

### Minor Changes

- 18fd6e4: Add explicit realtime session refresh support through `updateSession(...)`,
  including reconnect-based config updates, refresh reasons on session lifecycle
  events, and manager reuse across refresh and recovery flows.

## 0.4.0

### Minor Changes

- ba07abf: Add a manager-owned realtime tool registry with normalized tool handler types,
  tool timeout and failure handling, manager-side built-in `setEmotion`
  post-processing, and transport-level `sendToolResult(...)` support for
  provider-specific realtime clients.

## 0.3.0

### Minor Changes

- d773cca: Introduce a provider-agnostic realtime foundation with normalized core types,
  stateful realtime manager APIs, an adapter-dispatched
  `realtime-client-remote` package, and a new
  `realtime-provider-openai` server package.

## 0.2.0

### Minor Changes

- ca98036: Add explicit TTS player playback capabilities so `tts-core` can prefer
  `playbackMode` and `audioMimeType` over implicit detection. This also removes
  the old constructor-name and mime helper exports from `@charivo/tts-core`, so
  player implementations should declare their playback behavior explicitly.

## 0.1.0

### Minor Changes

- 0f9a342: Tighten the public core contracts around the event bus, render manager integration,
  and realtime session configuration. This release also republishes the affected
  public packages with corrected exports, type entrypoints, and package metadata so
  the published artifacts match the validated workspace builds.

  Additional fixes include end-to-end STT `language` forwarding for the remote flow,
  cleanup and lifecycle fixes in the web demo wiring, lower log noise in several
  packages, and improved Live2D package compatibility for bundled app builds.
