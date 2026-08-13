# @charivo/server

## 0.6.8

### Patch Changes

- Updated dependencies [7198359]
  - @charivo/core@0.25.0
  - @charivo/llm@0.9.1
  - @charivo/stt@0.7.5
  - @charivo/tts@0.6.9

## 0.6.7

### Patch Changes

- Updated dependencies [e1257cf]
  - @charivo/core@0.24.0
  - @charivo/llm@0.9.0
  - @charivo/stt@0.7.4
  - @charivo/tts@0.6.8

## 0.6.6

### Patch Changes

- Updated dependencies [f7caf22]
- Updated dependencies [f7caf22]
  - @charivo/core@0.23.0
  - @charivo/tts@0.6.7
  - @charivo/llm@0.8.3
  - @charivo/stt@0.7.3

## 0.6.5

### Patch Changes

- Updated dependencies [0727621]
  - @charivo/core@0.22.0
  - @charivo/llm@0.8.2
  - @charivo/stt@0.7.2
  - @charivo/tts@0.6.6

## 0.6.4

### Patch Changes

- 75174a1: Internal `@charivo/*` dependencies now publish as caret ranges (`workspace:^`) instead of exact pins (`workspace:*`), so a fresh install can dedupe this package against another compatible release of its `@charivo/*` dependencies instead of always nesting its own copy. While the workspace is on `0.x`, a caret range only spans patch releases of the same minor, so the full benefit lands once the affected packages reach `1.0.0` — installs mixing different `0.x` minors still nest separate copies today.

  Published tarballs also no longer include the `dist/metafile-*.json` build artifacts (esbuild bundle metadata used for internal build verification); they were never meant to ship to consumers.

- Updated dependencies [75174a1]
- Updated dependencies [75174a1]
  - @charivo/core@0.21.0
  - @charivo/llm@0.8.1
  - @charivo/tts@0.6.5
  - @charivo/stt@0.7.1

## 0.6.3

### Patch Changes

- Updated dependencies [666a7d4]
- Updated dependencies [03559a9]
  - @charivo/core@0.20.0
  - @charivo/llm@0.8.0
  - @charivo/stt@0.7.0
  - @charivo/tts@0.6.4

## 0.6.2

### Patch Changes

- Updated dependencies [370dfdc]
  - @charivo/core@0.19.0
  - @charivo/llm@0.7.2
  - @charivo/stt@0.6.4
  - @charivo/tts@0.6.3

## 0.6.1

### Patch Changes

- Updated dependencies [5d949a9]
  - @charivo/core@0.18.0
  - @charivo/llm@0.7.1
  - @charivo/stt@0.6.3
  - @charivo/tts@0.6.2

## 0.6.0

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
  - @charivo/llm@0.7.0
  - @charivo/stt@0.6.2
  - @charivo/tts@0.6.1

## 0.5.1

### Patch Changes

- Updated dependencies [f54cf31]
  - @charivo/core@0.16.0
  - @charivo/tts@0.6.0
  - @charivo/llm@0.6.2
  - @charivo/stt@0.6.1

## 0.5.0

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

## 0.4.1

### Patch Changes

- Updated dependencies [2a4656a]
  - @charivo/core@0.15.0
  - @charivo/stt@0.6.0
  - @charivo/llm@0.6.1
  - @charivo/tts@0.5.1

## 0.4.0

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

- af07e75: Pin OpenClaw conversations to a server-side gateway session.
  - Add `sessionKey` to `OpenClawLLMConfig`. When set, it is sent as the chat completion `user` field, which the OpenClaw gateway resolves to a stable session key. Without it the gateway opens a fresh session per request: the caller's history is still sent, so the model sees prior turns, but the gateway persists nothing between requests and each turn strands a throwaway session. With a session pinned, past turns are no longer resent (the gateway already holds them); system prompts are still sent every turn so the persona survives a dropped session. Rotate `sessionKey` to reset a conversation — the gateway keeps the old transcript under the old key. Behavior is unchanged when `sessionKey` is omitted.
  - **Behavior change:** the `x-openclaw-agent-id` header is now sent only when `agentId` is configured. It previously defaulted to `"main"`, which 400s on gateways that have no `main` agent. Omitting `agentId` now delegates to the gateway's configured default agent.
  - **Behavior change:** the default `model` is now `"openclaw/default"` (was `"openclaw"`). This value is an agent target, not a backend model name; `openclaw/default` is the documented stable alias.

### Patch Changes

- Updated dependencies [af96cbc]
- Updated dependencies [af07e75]
  - @charivo/llm@0.6.0
  - @charivo/tts@0.5.0
  - @charivo/stt@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [f82ba6f]
  - @charivo/core@0.14.0

## 0.3.1

### Patch Changes

- Updated dependencies [5a86dee]
  - @charivo/core@0.13.0

## 0.3.0

### Minor Changes

- 8f7d277: Expose inputAudioTranscription on RealtimeSessionConfig (model + enabled)

  `RealtimeSessionConfig` now accepts an optional `inputAudioTranscription` field for controlling user-microphone transcription on the provider:
  - `inputAudioTranscription: { model: "gpt-4o-mini-transcribe" }` selects a cheaper transcription model.
  - `inputAudioTranscription: { model: "gpt-4o-transcribe" }` selects the higher-quality option.
  - `inputAudioTranscription: { enabled: false }` disables transcription entirely (useful when the UI never displays the user transcript).

  Default behavior is unchanged when the field is unset — providers continue with their existing server-side defaults. The wire shape lands under `audio.input.transcription` per the OpenAI Realtime GA contract, and applies consistently across the legacy OpenAI WebRTC client, the OpenAI Agents SDK transport, and the server provider. Model strings are pass-through; unknown values surface as upstream errors from OpenAI rather than being validated locally. Example known values: `whisper-1`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`.

### Patch Changes

- Updated dependencies [8f7d277]
  - @charivo/core@0.12.0

## 0.2.4

### Patch Changes

- 9f069da: Keep OpenAI realtime provider default model and voice values behind named
  provider-local constants while preserving the existing fallback behavior.
- Updated dependencies [8826f2b]
  - @charivo/core@0.11.0

## 0.2.3

### Patch Changes

- Updated dependencies [79df4cc]
  - @charivo/core@0.10.0

## 0.2.2

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

## 0.1.0

- Initial coarse package release for server-side provider adapters.
