# @charivo/core

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
