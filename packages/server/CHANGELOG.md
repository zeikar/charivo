# @charivo/server

## 0.10.0

### Minor Changes

- 830ba82: Add a `@charivo/stt/gemini` subpath with `createGeminiSTTProvider` and
  `createGeminiSTTTranscriber`, posting audio inline to Gemini's
  `models/{model}:generateContent` endpoint over `fetch` with a default model of
  `gemini-3.5-transcribe`. `STTOptions.language` is optional and only a soft
  hint — the model transcribes what it hears even when the hint is wrong. The
  request runs behind a `timeoutMs` that defaults to 30s and also covers reading
  the response body. `@charivo/server/gemini` re-exports `createGeminiSTTProvider`
  alongside the existing LLM, TTS, and realtime providers.

### Patch Changes

- Updated dependencies [830ba82]
  - @charivo/stt@0.9.0

## 0.9.0

### Minor Changes

- 4374cb9: Add a `@charivo/tts/gemini` subpath with `createGeminiTTSProvider` and
  `createGeminiTTSPlayer`, wrapping Gemini's `models/{model}:generateContent`
  endpoint over `fetch` with a default model of `gemini-3.1-flash-tts-preview`
  and a default voice of `Kore`. The response's raw PCM is wrapped as a 16-bit
  WAV so existing players can consume it. The request goes out behind a fixed
  synthesis preamble, and a 5xx or a text-only answer is retried once inside the
  same `timeoutMs`, which defaults to 90s; a route behind `@charivo/tts/remote`
  must set `timeoutMs` below that player's fixed 30s so the server gives up
  first. `@charivo/server/gemini` re-exports `createGeminiTTSProvider` alongside
  the existing LLM and realtime providers. `TTSOptions.rate` and `pitch` are
  ignored: Gemini TTS has no speed or pitch parameter.

### Patch Changes

- Updated dependencies [4374cb9]
  - @charivo/tts@0.8.0

## 0.8.0

### Minor Changes

- a93620b: Add a `@charivo/llm/gemini` subpath with `createGeminiLLMProvider` and
  `createGeminiLLMClient`, wrapping Gemini's OpenAI-compatible endpoint
  (`https://generativelanguage.googleapis.com/v1beta/openai/`) with a default
  model of `gemini-3.5-flash-lite`. `@charivo/server/gemini` re-exports
  `createGeminiLLMProvider` alongside the existing realtime provider. Because
  `LLMToolCall` carries no thought signature, the provider resends tool-call
  history with Google's documented `skip_thought_signature_validator`
  placeholder on the first tool call of each assistant turn, which loses
  reasoning continuity across tool rounds.

### Patch Changes

- Updated dependencies [a93620b]
  - @charivo/llm@0.11.0

## 0.7.0

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
  - @charivo/llm@0.10.7
  - @charivo/stt@0.8.1
  - @charivo/tts@0.7.1

## 0.6.15

### Patch Changes

- Updated dependencies [e5ea6b7]
  - @charivo/core@0.32.0
  - @charivo/tts@0.7.0
  - @charivo/stt@0.8.0
  - @charivo/llm@0.10.5

## 0.6.14

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
  - @charivo/llm@0.10.4
  - @charivo/stt@0.7.11
  - @charivo/tts@0.6.15

## 0.6.13

### Patch Changes

- Updated dependencies [03d3d46]
  - @charivo/core@0.30.0
  - @charivo/llm@0.10.3
  - @charivo/stt@0.7.10
  - @charivo/tts@0.6.14

## 0.6.12

### Patch Changes

- Updated dependencies [7884f77]
  - @charivo/core@0.29.0
  - @charivo/llm@0.10.2
  - @charivo/stt@0.7.9
  - @charivo/tts@0.6.13

## 0.6.11

### Patch Changes

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

- Updated dependencies [13c3c3b]
  - @charivo/core@0.28.0
  - @charivo/llm@0.10.1
  - @charivo/stt@0.7.8
  - @charivo/tts@0.6.12

## 0.6.10

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
  - @charivo/llm@0.10.0
  - @charivo/tts@0.6.11
  - @charivo/stt@0.7.7

## 0.6.9

### Patch Changes

- Updated dependencies [1cb4c27]
- Updated dependencies [22a8f65]
  - @charivo/core@0.26.0
  - @charivo/llm@0.9.2
  - @charivo/stt@0.7.6
  - @charivo/tts@0.6.10

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
