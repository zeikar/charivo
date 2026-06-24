# @charivo/realtime

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
