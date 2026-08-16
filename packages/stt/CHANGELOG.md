# @charivo/stt

## 0.7.6

### Patch Changes

- Updated dependencies [1cb4c27]
- Updated dependencies [22a8f65]
  - @charivo/core@0.26.0

## 0.7.5

### Patch Changes

- Updated dependencies [7198359]
  - @charivo/core@0.25.0

## 0.7.4

### Patch Changes

- Updated dependencies [e1257cf]
  - @charivo/core@0.24.0

## 0.7.3

### Patch Changes

- Updated dependencies [f7caf22]
  - @charivo/core@0.23.0

## 0.7.2

### Patch Changes

- Updated dependencies [0727621]
  - @charivo/core@0.22.0

## 0.7.1

### Patch Changes

- 75174a1: Internal `@charivo/*` dependencies now publish as caret ranges (`workspace:^`) instead of exact pins (`workspace:*`), so a fresh install can dedupe this package against another compatible release of its `@charivo/*` dependencies instead of always nesting its own copy. While the workspace is on `0.x`, a caret range only spans patch releases of the same minor, so the full benefit lands once the affected packages reach `1.0.0` — installs mixing different `0.x` minors still nest separate copies today.

  Published tarballs also no longer include the `dist/metafile-*.json` build artifacts (esbuild bundle metadata used for internal build verification); they were never meant to ship to consumers.

- Updated dependencies [75174a1]
  - @charivo/core@0.21.0

## 0.7.0

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

- Updated dependencies [666a7d4]
- Updated dependencies [03559a9]
  - @charivo/core@0.20.0

## 0.6.4

### Patch Changes

- Updated dependencies [370dfdc]
  - @charivo/core@0.19.0

## 0.6.3

### Patch Changes

- Updated dependencies [5d949a9]
  - @charivo/core@0.18.0

## 0.6.2

### Patch Changes

- Updated dependencies [87ac34f]
  - @charivo/core@0.17.0

## 0.6.1

### Patch Changes

- Updated dependencies [f54cf31]
  - @charivo/core@0.16.0

## 0.6.0

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

### Patch Changes

- Updated dependencies [2a4656a]
  - @charivo/core@0.15.0

## 0.5.0

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

## 0.4.0

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

## 0.3.5

### Patch Changes

- Updated dependencies [f82ba6f]
  - @charivo/core@0.14.0

## 0.3.4

### Patch Changes

- Updated dependencies [5a86dee]
  - @charivo/core@0.13.0

## 0.3.3

### Patch Changes

- Updated dependencies [8f7d277]
  - @charivo/core@0.12.0

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

- 3aa84ad: Improve mobile realtime resilience by adding reconnect orchestration, reconnect
  observability events, direct microphone ownership with safer browser
  constraints, and iOS-friendly audio preparation hooks.

  `@charivo/render-live2d` now handles WebGL context loss by rebuilding the host
  and reloading the last model after restore. `@charivo/stt` now requests
  browser-safe microphone constraints by default.

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
