# @charivo/realtime

## 0.20.0

### Minor Changes

- 8266797: Add Gemini Live as a second realtime provider.

  `@charivo/server/gemini` mints constrained ephemeral tokens: the API key stays
  in a request header, and the token carries a full `bidiGenerateContentSetup`
  plus model and voice allow-lists, so a token cannot be repointed at another
  model. `@charivo/realtime/gemini` is the matching browser WebSocket transport —
  16 kHz capture, a 24 kHz playback scheduler with a lip-sync tap, barge-in, tool
  calls, and transcription mapping; for local development
  `createGeminiLiveClient({ apiKey })` mints the same token in the browser, the
  dev/testing escape hatch the OpenAI Agents transport already has.
  `@charivo/core` gains the `GEMINI_LIVE_ADAPTER` constant, and the remote client
  resolves it for `provider: "gemini"` with `transport: "websocket"`.

  Session resumption, `goAway` handover, connection rotation, context-window
  compression, and `updateSession()` are not implemented yet; the transport
  rejects `updateSession()` explicitly rather than pretending to apply it.

- 807fc15: Make `inputAudioTranscription` mean the same thing on every realtime provider:
  off unless asked, with `enabled` as the switch. `{ enabled: true }` now turns
  transcription on with the provider's default model — the OpenAI provider and
  transports used to ignore it silently without a `model`, because OpenAI
  requires one; the default is `gpt-4o-mini-transcribe`. `{ model }` still
  implies on where the provider offers a choice, and `{ enabled: false }` still
  turns it off. The Gemini provider no longer requests input transcription unless
  asked.

### Patch Changes

- Updated dependencies [8266797]
  - @charivo/core@0.33.0

## 0.19.0

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

### Patch Changes

- Updated dependencies [e5ea6b7]
  - @charivo/core@0.32.0

## 0.18.1

### Patch Changes

- 9d9ba15: Give the remaining packages npm keywords

  Only `@charivo/tts` and `@charivo/stt` carried `keywords`, so the other seven
  published packages were reachable on npm by name alone — including `core` and
  `render-live2d`, the two anyone looking for this project would search for
  first. Each now lists five, in the shape the existing two set: `charivo`, then
  what that package actually does.

  Manifest metadata only. No code, exports, or types change.

- Updated dependencies [21d19b3]
- Updated dependencies [9d9ba15]
  - @charivo/core@0.31.0

## 0.18.0

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

### Patch Changes

- 2e561ae: Stop a cancelled turn from releasing the replacement turn's send lock.

  Interrupting a response and immediately sending a replacement let the cancelled
  turn's late lifecycle events be credited to the replacement, which released its
  send lock and admitted a duplicate send. Both built-in transports now condemn a
  response the wire proves is in flight when `interrupt()` runs — any acknowledged
  response, client-requested or created by server VAD — and drop that turn's
  assistant lifecycle events while the suppression holds. The low-level transport
  also covers a client-requested response interrupted before its acknowledgement,
  and repeated interrupt-and-replace cycles, which a single suppression flag could
  not survive.

  A cancel that loses the race to server-side completion no longer surfaces as a
  transport error; it was reaching the manager's error path and freeing the
  replacement's lock by another route.

  Tool events stay live across an interrupt and audio events keep reporting real
  playback. The windows that remain uncovered are listed in the realtime guide.

- Updated dependencies [03d3d46]
  - @charivo/core@0.30.0

## 0.17.0

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

### Patch Changes

- 6a476b8: Stop the sound when the direct OpenAI transport is interrupted during tail
  playback.

  `interrupt()` returned early unless a response was still generating, so it did
  nothing at all once `response.done` had arrived — the exact window where playback
  is still draining and an interrupt is what a caller wants. Cancelling stops
  generation; clearing the output buffer is what stops the sound, and that is now
  sent whenever audio output is open, independently of whether there is a response
  left to cancel. The agents transport already did this.

- Updated dependencies [7884f77]
  - @charivo/core@0.29.0

## 0.16.1

### Patch Changes

- c9693db: Fix two agents-adapter defects that only surface on the second turn of a
  realtime session.

  **Lip-sync stopped after the first reply.** Analysis is paused at every playback
  end, and resuming it hung off the SDK's `audio_start` event. That event is
  derived from a transport `audio` event which only the SDK's WebSocket transport
  emits, so a WebRTC session never received it: the analyzer was paused when the
  first reply finished and nothing ever resumed it. Audio kept playing to a still
  mouth for the rest of the session, and because `audioOutputActive` never became
  true, the visibility and pageshow resume paths were dead too. Playback segments
  now open on `output_audio_buffer.started` — the counterpart to the buffer events
  that already closed them, and on WebRTC the only start signal that arrives. Both
  signals feed one idempotent path, so a WebSocket transport still reports exactly
  one start, and teardown clears the open-segment flag so a reconnect during
  playback does not swallow the next session's first start.

  **A turn ending without text stranded the response lock.** The client suppresses
  the completion event for the first `agent_end` of a tool-using turn, where the
  real reply is still coming. It detected that sub-cycle by the turn being empty,
  so any turn that simply ended without text — a tool that failed, a reply the
  model never spoke — was swallowed the same way. `RealtimeManager` releases its
  send lock on that event, so it stayed locked and every later `sendMessage` threw
  `Response already in progress` until an interrupt or a reconnect. The suppression
  is now gated on `response.done` actually reporting a function call. A genuinely
  empty turn completes with empty text rather than resurrecting the previous
  turn's message from history.

## 0.16.0

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

### Patch Changes

- Updated dependencies [13c3c3b]
  - @charivo/core@0.28.0

## 0.15.9

### Patch Changes

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

- Updated dependencies [f2ddcbe]
- Updated dependencies [8dbacf9]
- Updated dependencies [8dbacf9]
  - @charivo/core@0.27.0

## 0.15.8

### Patch Changes

- Updated dependencies [1cb4c27]
- Updated dependencies [22a8f65]
  - @charivo/core@0.26.0

## 0.15.7

### Patch Changes

- 4792908: Apply the playback-end fix to the raw `@charivo/realtime/openai` WebRTC
  transport, which had the same defect as the OpenAI Agents transport.

  It ended audio output on `response.audio.done` / `response.output_audio.done`,
  which report that the SERVER finished sending audio rather than that the browser
  finished playing it. Buffered audio is still playing at that point, so
  `tts:audio:end` fired seconds early and consumers acted on it mid-sentence —
  `RenderManager` releases a held expression there, resetting an avatar's face
  partway through its own reply.

  Only the output-buffer events now end audio output: `output_audio_buffer.stopped`
  when playback finishes, and `output_audio_buffer.cleared` when an interruption
  discards the buffer (previously unhandled). Lip-sync analysis is paused at the
  end and resumed when the next segment starts, so a decaying residual level
  cannot re-open output that no further buffer event would close.

  Both WebRTC transports also stop resuming lip-sync analysis from page
  visibility and pageshow handlers unless a playback segment is actually open.
  Resuming after playback ended would meter residual level, which
  `RealtimeManager` reads as a new audio start that no later buffer event would
  close.

## 0.15.6

### Patch Changes

- 4dbc175: Fix `tts:audio:end` firing while the character is still speaking in realtime
  sessions.

  The OpenAI Agents WebRTC transport reported the end of audio output from the
  SDK's `audio_stopped`, which is raised on the server's
  `response.output_audio.done` — that reports the server finished SENDING audio,
  not that the browser finished PLAYING it. There is still buffered audio at that
  point, so the end arrived seconds early. Consumers that treat `tts:audio:end` as
  "the speech this accompanied is over" acted on it mid-sentence: `RenderManager`
  releases a held expression there, so an avatar's face reset partway through its
  own reply, and realtime lip-sync stopped with it.

  The end is now reported from `output_audio_buffer.stopped`, the WebRTC event for
  the output buffer actually stopping — the same signal `@charivo/realtime/openai`
  already treats as completion.

  No timer or audio-level heuristic stands in for that event. A speculative end
  reproduces the original defect, and an expression released mid-reply cannot be
  un-released by a later correction; a session that never sees the event instead
  holds the expression until `RenderManager`'s existing cap releases it. Interruption is reported from `output_audio_buffer.cleared`, which is what
  `interrupt()` and automatic VAD barge-in actually produce on this transport —
  the SDK's `audio_interrupted` is emitted only by its WebSocket transport and
  never arrives over WebRTC. Reconnect, errors, and session teardown continue to
  end audio output immediately as before.

## 0.15.5

### Patch Changes

- Updated dependencies [7198359]
  - @charivo/core@0.25.0

## 0.15.4

### Patch Changes

- Updated dependencies [e1257cf]
  - @charivo/core@0.24.0

## 0.15.3

### Patch Changes

- Updated dependencies [f7caf22]
  - @charivo/core@0.23.0

## 0.15.2

### Patch Changes

- Updated dependencies [0727621]
  - @charivo/core@0.22.0

## 0.15.1

### Patch Changes

- 75174a1: Internal `@charivo/*` dependencies now publish as caret ranges (`workspace:^`) instead of exact pins (`workspace:*`), so a fresh install can dedupe this package against another compatible release of its `@charivo/*` dependencies instead of always nesting its own copy. While the workspace is on `0.x`, a caret range only spans patch releases of the same minor, so the full benefit lands once the affected packages reach `1.0.0` — installs mixing different `0.x` minors still nest separate copies today.

  Published tarballs also no longer include the `dist/metafile-*.json` build artifacts (esbuild bundle metadata used for internal build verification); they were never meant to ship to consumers.

- Updated dependencies [75174a1]
  - @charivo/core@0.21.0

## 0.15.0

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

### Patch Changes

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

- Updated dependencies [666a7d4]
- Updated dependencies [03559a9]
  - @charivo/core@0.20.0

## 0.14.1

### Patch Changes

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

- Updated dependencies [370dfdc]
  - @charivo/core@0.19.0

## 0.14.0

### Minor Changes

- 5d949a9: Remove the deprecated `Realtime*` tool type aliases (`RealtimeTool`, `RealtimeToolContext`, `RealtimeToolHandler`, `RealtimeToolRegistration`, `RealtimeToolResultProjector`, `RealtimeToolResultProjectorContext`). Use the neutral `Tool*` contracts from `@charivo/core` instead (`ToolDefinition`, `ToolContext`, `ToolHandler`, `ToolRegistration`, `ToolResultProjector`, `ToolResultProjectorContext`); imports of the old names map 1:1 to the neutral ones. The `@charivo/realtime-avatar` package is also removed from the repo — its already-published versions keep working and continue to re-export `@charivo/avatar`.

### Patch Changes

- Updated dependencies [5d949a9]
  - @charivo/core@0.18.0

## 0.13.0

### Minor Changes

- 87ac34f: Bring tool-based avatar control (expression / motion / gaze) to the text LLM path, sharing one tool architecture with realtime sessions.
  - New `@charivo/avatar` package: catalog-constrained avatar tool builders (`createAvatarControlTools`, `buildAvatarControlInstructions`, `createAvatarResultProjector`) depending only on `@charivo/core`, usable by both realtime and LLM sessions.
  - `@charivo/realtime-avatar` is deprecated and now re-exports `@charivo/avatar`; migrate imports (`RealtimeToolResultProjector` → core `ToolResultProjector`).
  - LLM contracts gain optional tool calling: `LLMClient.callWithTools` / `LLMProvider.generateResponseWithTools`, role-discriminated `LLMMessage`, `LLMToolCall`, `LLMToolResponse`. `LLMManager` gains a tool registry (`tools`, `resultProjectors`, `toolInstructions`, `defaultToolTimeoutMs` options plus `registerTool`/`unregisterTool`/`getRegisteredTools`/`setToolInstructions`/`setEventEmitter`) with a validated 3-round execution loop, `avatar:*` event projection, and `Charivo.attachLLM` emitter wiring. Tool turns are not persisted to history; tool-less usage is unchanged.
  - OpenAI/OpenClaw providers and the remote client implement tool calling with validated wire DTOs; the remote `/api/chat` protocol gains `tools` in the request and `toolCalls` in the response.
  - Core tool contracts generalized to neutral names (`ToolDefinition`/`ToolContext`/`ToolHandler`/`ToolRegistration`/`ToolResultProjector`) with shared `validateToolArguments`/`assertToolResultObject`; `Realtime*` tool names remain as deprecated interfaces/aliases.
  - Breaking (pre-1.0 minor): the `realtime:expression|motion|gaze` events are renamed to `avatar:expression|motion|gaze`; avatar helpers should be imported from `@charivo/avatar`.

### Patch Changes

- Updated dependencies [87ac34f]
  - @charivo/core@0.17.0

## 0.12.0

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

### Patch Changes

- Updated dependencies [f54cf31]
  - @charivo/core@0.16.0

## 0.11.0

### Minor Changes

- 30f4ae6: Move the default OpenAI realtime model from `gpt-realtime-mini` to
  `gpt-realtime-2.1-mini`.

  OpenAI has deprecated the `gpt-realtime` / `gpt-realtime-mini` family (API
  shutdown on 2027-01-20). Sessions that do not pass an explicit `model` now
  run on `gpt-realtime-2.1-mini`, the successor OpenAI recommends. Sessions
  that set `model` explicitly are unaffected — model strings remain
  pass-through. If you stay on an older charivo release past the shutdown
  date, pin a supported model explicitly (e.g.
  `startSession({ provider: "openai", model: "gpt-realtime-2.1-mini" })`).

## 0.10.1

### Patch Changes

- Updated dependencies [2a4656a]
  - @charivo/core@0.15.0

## 0.10.0

### Minor Changes

- f018bed: Lock the public API surface to factory-only ahead of 1.0.

  Browser clients, players, transcribers, managers, and renderers are no longer
  exported as concrete classes — create them via their `create*` factory, which
  now returns the public interface (`LLMClient`, `TTSPlayer`, `STTTranscriber`,
  `RealtimeTransportClient`, `Renderer`, and a new public `Live2DRenderer`
  interface) rather than the implementation class.
  - `@charivo/llm`: root is factory-only (`createLLMManager` + `LLMManagerOptions`); the internal builder helpers (`CharacterPromptBuilder`, `MessageConverter`, `ResponseMessageBuilder`, `LLMValidators`, `MessageHistoryManager`) and the direct client classes are no longer exported.
  - `@charivo/tts` / `@charivo/stt`: roots are factory-only; player/transcriber classes, `STTManagerImpl`, and internal helpers (`MediaRecorderHelper`, `WebSpeechLipSyncSimulator`, tts-utils) are no longer exported.
  - `@charivo/realtime`: `RealtimeManagerImpl` and the transport client classes (`RemoteRealtimeClient`, `OpenAIRealtimeClient`, `OpenAIRealtimeAgentsClient`) are no longer exported.
  - `@charivo/render`: `RenderManager` and `RealTimeLipSync` are no longer exported; `@charivo/render/stub` adds a `createConsoleRenderer()` factory and hides `ConsoleRenderer`.
  - `@charivo/render-live2d`: the concrete renderer class is hidden behind a new public `Live2DRenderer` interface; construct via `createLive2DRenderer()`.

  Migration: replace any `new <Class>(...)` / direct class import from these packages with the corresponding `create*` factory. Factory and config/options type names are unchanged. The one capability that did not move to an instance method — the Web Speech support check previously reachable via `new WebSTTTranscriber().isSupportedBrowser()` — is now the standalone, SSR-safe `isWebSTTSupported()` export from `@charivo/stt/web`.

## 0.9.0

### Minor Changes

- bc3c85c: `createOpenAIRealtimeAgentsClient` now accepts an optional `apiKey` (dev/testing only) that mints an ephemeral realtime client secret in-browser via `POST /v1/realtime/client_secrets`, mirroring `@charivo/llm/openai` and `@charivo/tts/openai`. Option precedence is `sessionBootstrap` > `apiEndpoint` > `apiKey`.

## 0.8.4

### Patch Changes

- Updated dependencies [f82ba6f]
  - @charivo/core@0.14.0

## 0.8.3

### Patch Changes

- Updated dependencies [5a86dee]
  - @charivo/core@0.13.0

## 0.8.2

### Patch Changes

- d168d35: Bound retained realtime history to the latest assistant text; no change to normal completion behavior.

## 0.8.1

### Patch Changes

- a8fd4b3: Deduplicate internal helpers in the OpenAI realtime client

  Behavior-preserving refactor of `openai/client.ts`: the duplicated WebRTC bootstrap validation (initial connect + ICE-restart recovery) now shares a single `resolveWebRTCAnswerSdp` helper, the repeated assistant-response-started guard is extracted into `ensureAssistantResponseStarted`, and the two identical `*.done` final-text reconciliation blocks collapse into `emitFinalAssistantText`. The local `delay` duplicate is replaced with the shared `internal/timing` export. No public API or behavior change.

- c4e206f: Reuse the shared LipSyncAnalyzer in the OpenAI realtime client

  Behavior-preserving refactor of `openai/client.ts`: the inline AudioContext/analyser/RMS lip-sync loop (and its `audioContext`/`audioSource`/`analyser`/`lipSyncInterval` fields) is replaced by the existing `LipSyncAnalyzer` already used by the OpenAI Agents transport. The RMS math, `fftSize`, smoothing, and 60fps cadence are unchanged. No public API or behavior change.

## 0.8.0

### Minor Changes

- 8f7d277: Expose inputAudioTranscription on RealtimeSessionConfig (model + enabled)

  `RealtimeSessionConfig` now accepts an optional `inputAudioTranscription` field for controlling user-microphone transcription on the provider:
  - `inputAudioTranscription: { model: "gpt-4o-mini-transcribe" }` selects a cheaper transcription model.
  - `inputAudioTranscription: { model: "gpt-4o-transcribe" }` selects the higher-quality option.
  - `inputAudioTranscription: { enabled: false }` disables transcription entirely (useful when the UI never displays the user transcript).

  Default behavior is unchanged when the field is unset — providers continue with their existing server-side defaults. The wire shape lands under `audio.input.transcription` per the OpenAI Realtime GA contract, and applies consistently across the legacy OpenAI WebRTC client, the OpenAI Agents SDK transport, and the server provider. Model strings are pass-through; unknown values surface as upstream errors from OpenAI rather than being validated locally. Example known values: `whisper-1`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`.

- d7de06e: Reject sendMessage while a realtime response is in progress

  `RealtimeManager.sendMessage()` now throws `CharivoStateError` when
  `state.response.status === "responding"`. Previously the call was forwarded
  to the underlying transport client, which either silently dropped it (legacy
  OpenAI client) or caused OpenAI to auto-cancel the in-progress response and
  start a new one — paying for tokens that were immediately discarded.

  **Behavior/contract change:** callers who relied on silent-drop or
  auto-cancel behavior must now call `interrupt()` first and wait for it to
  resolve before sending a new message.

  The guard order in `sendMessage` is: session active → connection connected →
  response not in progress.

  `sendAudioChunk` is intentionally unaffected. Audio chunks are continuous
  streaming input and overlap is handled by OpenAI VAD/turn-detection on the
  server side.

### Patch Changes

- 3c2418a: Auto-refresh active realtime session when tools are registered or unregistered

  Previously, tools registered or unregistered after `startSession()` were silently invisible to the provider until the caller explicitly called `updateSession()`. The `registerTool` and `unregisterTool` methods now enqueue a session refresh automatically when a session is active. Idle managers (no active session) are unaffected and incur no cost.

- Updated dependencies [8f7d277]
  - @charivo/core@0.12.0

## 0.7.2

### Patch Changes

- f773b55: Validate realtime custom tool arguments before invoking handlers.

## 0.7.1

### Patch Changes

- 6598f6b: Rewrite realtime and avatar prompts in a descriptive tone instead of count-prescriptive language. The avatar instruction addendum now emits expression, motion, and pairing guidance only when those tools are available in the active catalog. Tool descriptions and the default realtime prompt drop quantifiers like "single", "one", and "at most one" in favor of quality framing such as "don't stack body motions in the same reply".

## 0.7.0

### Minor Changes

- 9cef27f: Make generic realtime tool prompting more proactive, and add avatar-specific instruction helpers for expression, motion, and gaze behavior.
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

### Patch Changes

- Updated dependencies [8826f2b]
  - @charivo/core@0.11.0

## 0.6.0

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

### Patch Changes

- Updated dependencies [79df4cc]
  - @charivo/core@0.10.0

## 0.5.0

### Minor Changes

- 7d6608f: Freeze the top-level Charivo API by adding symmetric `detachLLM()` /
  `detachRenderer()` coverage plus `dispose()`, and normalize public failures to
  typed `CharivoError` subclasses.

  Breaking change: public throws now use typed errors from `@charivo/core`
  instead of relying on generic `Error` strings. Consumers should switch from
  `error.message.includes(...)` checks to `instanceof CharivoError` or
  `error.code`.

### Patch Changes

- Updated dependencies [7d6608f]
  - @charivo/core@0.9.0

## 0.4.0

### Minor Changes

- 3aa84ad: Improve mobile realtime resilience by adding reconnect orchestration, reconnect
  observability events, direct microphone ownership with safer browser
  constraints, and iOS-friendly audio preparation hooks.

  `@charivo/render-live2d` now handles WebGL context loss by rebuilding the host
  and reloading the last model after restore. `@charivo/stt` now requests
  browser-safe microphone constraints by default.

### Patch Changes

- Updated dependencies [3aa84ad]
  - @charivo/core@0.8.0

## 0.3.0

### Minor Changes

- 630656c: Change `updateSession(...)` to patch active realtime sessions in place instead of reconnecting, remove synthetic refresh lifecycle boundaries, keep the current session alive on patch failure, and forward `temperature` / `maxTokens` in OpenAI session updates.

  Tighten the raw OpenAI patch flow so unrelated server errors do not reject in-flight session updates, require `interrupt()` before patching during an active response, add a configurable session update ack timeout, and bump `@openai/agents-realtime` to `0.8.5`.

## 0.2.2

### Patch Changes

- 705d00c: Tighten the default realtime avatar prompting so lightweight reactions bias toward `lookAt` instead of frequent expression changes.

## 0.2.1

### Patch Changes

- df514bd: Tighten the default realtime agent instructions and the `lookAt` tool description so the model avoids bracketed stage directions (e.g. `[smile]`, `*laughs*`, `(gently)`) even when no avatar tools are available, and treats natural directional phrases as gaze triggers. Also clarifies the `x` / `y` parameter semantics on `lookAt` so coordinates match the intended direction.
- 896885a: Stop emitting a spurious `assistant.response.completed` event for the intermediate sub-cycle that closes when a tool call is dispatched. Tool-using user turns now produce a single `assistant.response.started` / `assistant.response.completed` pair that carries the post-tool reply, instead of two pairs where the first carried stale text (on the OpenAI Agents adapter) or an empty string (on the OpenAI adapter). Consumers that counted completions per user turn are no longer off-by-one when tools run.

## 0.2.0

### Minor Changes

- defca13: Consolidate the public package surface into coarse modality packages and a subpath-only server package.

  This release removes the old fine-grained package names in favor of:
  - `@charivo/llm`
  - `@charivo/tts`
  - `@charivo/stt`
  - `@charivo/realtime`
  - `@charivo/render`
  - `@charivo/server`

  It also moves adapter/provider entrypoints to subpaths, keeps `@charivo/render-live2d` separate, and documents that consumers need `moduleResolution: "bundler" | "node16" | "nodenext"` for package subpath exports.

## 0.5.0

### Minor Changes

- c2e1cb8: Add canonical avatar control support with expression, motion, and gaze events/tools, and remove the legacy emotion-based avatar control surface.

### Patch Changes

- Updated dependencies [c2e1cb8]
  - @charivo/core@0.7.0

## 0.4.1

### Patch Changes

- Updated dependencies [ec19d59]
  - @charivo/core@0.6.0

## 0.4.0

### Minor Changes

- 18fd6e4: Add explicit realtime session refresh support through `updateSession(...)`,
  including reconnect-based config updates, refresh reasons on session lifecycle
  events, and manager reuse across refresh and recovery flows.

### Patch Changes

- Updated dependencies [18fd6e4]
  - @charivo/core@0.5.0

## 0.3.0

### Minor Changes

- ba07abf: Add a manager-owned realtime tool registry with normalized tool handler types,
  tool timeout and failure handling, manager-side built-in `setEmotion`
  post-processing, and transport-level `sendToolResult(...)` support for
  provider-specific realtime clients.

### Patch Changes

- Updated dependencies [ba07abf]
  - @charivo/core@0.4.0

## 0.2.0

### Minor Changes

- d773cca: Introduce a provider-agnostic realtime foundation with normalized core types,
  stateful realtime manager APIs, an adapter-dispatched
  `realtime-client-remote` package, and a new
  `realtime-provider-openai` server package.

### Patch Changes

- Updated dependencies [d773cca]
  - @charivo/core@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [ca98036]
  - @charivo/core@0.2.0

## 0.1.0

### Minor Changes

- 0f9a342: Tighten the public core contracts around the event bus, render manager integration,
  and realtime session configuration. This release also republishes the affected
  public packages with corrected exports, type entrypoints, and package metadata so
  the published artifacts match the validated workspace builds.

  Additional fixes include end-to-end STT `language` forwarding for the remote flow,
  cleanup and lifecycle fixes in the web demo wiring, lower log noise in several
  packages, and improved Live2D package compatibility for bundled app builds.

### Patch Changes

- Updated dependencies [0f9a342]
  - @charivo/core@0.1.0
