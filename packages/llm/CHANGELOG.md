# @charivo/llm

## 0.9.1

### Patch Changes

- Updated dependencies [7198359]
  - @charivo/core@0.25.0

## 0.9.0

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

### Patch Changes

- Updated dependencies [e1257cf]
  - @charivo/core@0.24.0

## 0.8.3

### Patch Changes

- Updated dependencies [f7caf22]
  - @charivo/core@0.23.0

## 0.8.2

### Patch Changes

- Updated dependencies [0727621]
  - @charivo/core@0.22.0

## 0.8.1

### Patch Changes

- 75174a1: Internal `@charivo/*` dependencies now publish as caret ranges (`workspace:^`) instead of exact pins (`workspace:*`), so a fresh install can dedupe this package against another compatible release of its `@charivo/*` dependencies instead of always nesting its own copy. While the workspace is on `0.x`, a caret range only spans patch releases of the same minor, so the full benefit lands once the affected packages reach `1.0.0` — installs mixing different `0.x` minors still nest separate copies today.

  Published tarballs also no longer include the `dist/metafile-*.json` build artifacts (esbuild bundle metadata used for internal build verification); they were never meant to ship to consumers.

- Updated dependencies [75174a1]
  - @charivo/core@0.21.0

## 0.8.0

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

### Patch Changes

- Updated dependencies [666a7d4]
- Updated dependencies [03559a9]
  - @charivo/core@0.20.0

## 0.7.2

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

## 0.7.1

### Patch Changes

- Updated dependencies [5d949a9]
  - @charivo/core@0.18.0

## 0.7.0

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

## 0.6.2

### Patch Changes

- Updated dependencies [f54cf31]
  - @charivo/core@0.16.0

## 0.6.1

### Patch Changes

- Updated dependencies [2a4656a]
  - @charivo/core@0.15.0

## 0.6.0

### Minor Changes

- af96cbc: Deduplicate the provider implementations shared by the modality packages and `@charivo/server`.

  **Additive — the modality subpaths now export their server-side providers.**
  `@charivo/llm/openai`, `@charivo/llm/openclaw`, `@charivo/tts/openai`, and `@charivo/stt/openai` each now export their provider factory, provider class, and provider config type (`createOpenAILLMProvider` / `OpenAILLMProvider` / `OpenAILLMConfig`, and the OpenClaw, TTS, and STT equivalents) alongside the browser client, player, and transcriber factories they already exported. `@charivo/server/openai` and `@charivo/server/openclaw` now re-export those same names instead of duplicating the implementations — every existing `@charivo/server` import keeps working, with names, shapes, and concrete factory return types unchanged. The realtime provider is still implemented in `@charivo/server`. No new provider implementation or class capability is introduced; the same four provider classes are now sourced from one place instead of two.

  `@charivo/llm/openclaw`'s `sessionKey` (pins a conversation to a gateway-side session) lives on the provider config only. It is deliberately absent from the client config: the client is driven by `LLMManager`, whose `clearHistory()` and character switch clear only local history and cannot rotate a pinned gateway session, so a reset conversation would silently continue on the gateway's old transcript.

  **Breaking — `@charivo/server`'s LLM/TTS/STT and realtime providers now throw `CharivoError` subclasses instead of plain `Error`s.**
  - SDK failures throw `CharivoProviderError` (`code: "CHARIVO_PROVIDER_ERROR"`). The SDK's message is preserved and the original error is kept on `cause`. The `"OpenAI LLM Error: …"` and `"OpenClaw LLM Error: …"` message prefixes are gone, and the TTS and STT providers now wrap SDK failures where they previously propagated them raw.
  - The realtime provider's HTTP failures (WebRTC session request, client secret request, invalid client secret response) also throw `CharivoProviderError`; the `"OpenAI Realtime Error: …"` message text is unchanged.
  - Request timeouts throw `CharivoTimeoutError` (`code: "CHARIVO_TIMEOUT_ERROR"`). This applies to the OpenAI LLM, TTS, STT, and realtime providers, which all have a 30s timeout; the OpenClaw provider has no timeout wrapper. The OpenAI LLM timeout message gains its provider prefix (`"request timed out after 30000ms"` → `"OpenAI LLM request timed out after 30000ms"`); the realtime timeout message is unchanged.
  - Constructing a provider in a browser without `dangerouslyAllowBrowser` throws `CharivoStateError` (`code: "CHARIVO_STATE_ERROR"`); the message text is unchanged. The realtime provider also throws `CharivoStateError` for invalid session requests (unsupported provider, transport, or adapter; missing SDP offer); those message texts are unchanged too.

  `CharivoError extends Error`, so `catch (e)` and `e.message` still work. Code that matches on the old message prefixes, or that checks `e.constructor === Error`, does not. For the realtime provider specifically, every message string is byte-identical to before this change, so only `instanceof` / `e.constructor === Error` checks are affected.

- af07e75: Fix OpenClaw agent targeting in the direct OpenClaw client.
  - **Behavior change:** the `x-openclaw-agent-id` header is now sent only when `agentId` is configured. It previously defaulted to `"main"`, which 400s on gateways that have no `main` agent. Omitting `agentId` now delegates to the gateway's configured default agent.
  - **Behavior change:** the default `model` is now `"openclaw/default"` (was `"openclaw"`). This value is an agent target, not a backend model name; `openclaw/default` is the documented stable alias.

  Note that `sessionKey` (added in `@charivo/server/openclaw`) is intentionally not offered here: this provider is driven by `LLMManager`, whose `clearHistory()` and character switch clear only local history and cannot rotate a pinned gateway session, so a reset conversation would silently continue on the old transcript.

## 0.5.0

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

## 0.4.3

### Patch Changes

- Updated dependencies [f82ba6f]
  - @charivo/core@0.14.0

## 0.4.2

### Patch Changes

- Updated dependencies [5a86dee]
  - @charivo/core@0.13.0

## 0.4.1

### Patch Changes

- Updated dependencies [8f7d277]
  - @charivo/core@0.12.0

## 0.4.0

### Minor Changes

- 2bd1689: Bound LLM manager history to the latest 40 turns by default. Existing consumers
  that rely on unbounded history can opt out with `maxHistoryTurns: null`.

## 0.3.2

### Patch Changes

- Updated dependencies [8826f2b]
  - @charivo/core@0.11.0

## 0.3.1

### Patch Changes

- Updated dependencies [79df4cc]
  - @charivo/core@0.10.0

## 0.3.0

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

## 0.2.1

### Patch Changes

- Updated dependencies [3aa84ad]
  - @charivo/core@0.8.0

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

## 0.0.8

### Patch Changes

- Updated dependencies [c2e1cb8]
  - @charivo/core@0.7.0

## 0.0.7

### Patch Changes

- Updated dependencies [ec19d59]
  - @charivo/core@0.6.0

## 0.0.6

### Patch Changes

- Updated dependencies [18fd6e4]
  - @charivo/core@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [ba07abf]
  - @charivo/core@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d773cca]
  - @charivo/core@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [ca98036]
  - @charivo/core@0.2.0

## 0.0.2

### Patch Changes

- 0f9a342: Tighten the public core contracts around the event bus, render manager integration,
  and realtime session configuration. This release also republishes the affected
  public packages with corrected exports, type entrypoints, and package metadata so
  the published artifacts match the validated workspace builds.

  Additional fixes include end-to-end STT `language` forwarding for the remote flow,
  cleanup and lifecycle fixes in the web demo wiring, lower log noise in several
  packages, and improved Live2D package compatibility for bundled app builds.

- Updated dependencies [0f9a342]
  - @charivo/core@0.1.0
