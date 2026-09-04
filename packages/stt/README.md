# @charivo/stt

Stateful STT manager and recording helper for Charivo.

## Install

```bash
pnpm add @charivo/stt
```

## Usage

```ts
import { createSTTManager } from "@charivo/stt";
import { createRemoteSTTTranscriber } from "@charivo/stt/remote";

const sttManager = createSTTManager(
  createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" }),
);

await sttManager.start({ language: "en" });
const text = await sttManager.stop();
```

## Exports

- `createSTTManager(transcriber)`
- `isWebSTTSupported()` (from `@charivo/stt/web`) — SSR-safe check for Web Speech recognition support
- `@charivo/stt/openai`: `createOpenAISTTTranscriber(config)` (browser
  transcriber, dev/testing only) and, for server-side use,
  `createOpenAISTTProvider(config)`, `OpenAISTTProvider`, `type OpenAISTTConfig`
- `@charivo/stt/gemini`: `createGeminiSTTTranscriber(config)` (browser
  transcriber, dev/testing only) and, for server-side use,
  `createGeminiSTTProvider(config)`, `GeminiSTTProvider`, `type GeminiSTTConfig`.
  The recording is posted inline (base64) to Gemini's
  `models/{model}:generateContent` over `fetch`, with a default model of
  `gemini-3.5-transcribe`. `language` is optional and only a soft hint —
  the model transcribes what it hears even when the hint is wrong. `timeoutMs`
  defaults to 30s and also covers reading the response body. Inline requests
  are capped at 20MB, and there is no streaming: `gemini-3.5-transcribe-live`
  is WebSocket-only — `generateContent` rejects it with a 400 — and is served by
  `@charivo/stt/gemini-live` below. Gemini's free-tier rate limit surfaces as a
  429 wrapped in a provider error.
- `@charivo/stt/openai-realtime`: `createOpenAIRealtimeSTTTranscriber({ bootstrap })`
  (live WebRTC streaming transcriber, `gpt-realtime-whisper`) — the app injects
  `bootstrap(request) => Promise<{ answerSdp }>`, owns the credentials, and
  mints the `type: "transcription"` session with `turn_detection: null`; no
  key-bearing helper is shipped
- `@charivo/stt/gemini-live`: `createGeminiLiveSTTTranscriber({ bootstrap })`
  (live WebSocket streaming transcriber over the Gemini Live API,
  `gemini-3.5-transcribe-live`) — the app injects
  `bootstrap(request) => Promise<{ url, token }>`, owns the credentials, and
  mints the single-use ephemeral token whose setup pins the model, the `TEXT`
  response modality, and manual VAD. No key-bearing helper is shipped, but
  unlike the OpenAI path's SDP answer that token is itself a credential: the
  browser holds it for the life of one recording. `url` must be the Live
  API's `BidiGenerateContentConstrained` websocket endpoint (the
  ephemeral-token one), with scheme `ws:` or `wss:` (the transcriber rejects
  any other scheme) and no fragment (the native `WebSocket` constructor
  rejects one); the transcriber parses `url` and adds `access_token` as a
  query parameter, so an existing query string on it survives. Pinning manual
  VAD in the token is a requirement rather than a detail: its
  `bidiGenerateContentSetup` replaces the setup frame the transcriber sends
  rather than merging with it, so a bootstrap that leaves manual VAD out
  silently loses the recording — server VAD cuts the audio at every pause,
  each transcription replaces the running snapshot instead of extending it,
  and `stop()` then returns the last segment alone or times out. Each
  `stt:partial` is a whole-recording snapshot that may be *revised*, not a
  delta, so a UI must replace its draft rather than append to it

## Event Bridge

`STTManager` accepts an emit-only event bridge through `setEventEmitter(...)`.
It emits STT lifecycle and error events back into core, and does not subscribe
through the shared event bus.

When connected, the manager emits:

- `stt:start`
- `stt:partial` (streaming transcribers only — `@charivo/stt/openai-realtime`
  and `@charivo/stt/gemini-live`)
- `stt:stop`
- `stt:error`

For either streaming transcriber, a mid-session failure does not push an event
on its own — it surfaces the next time the app calls `stop()`, which rejects and
emits `stt:error` (never a successful `stt:stop`).
