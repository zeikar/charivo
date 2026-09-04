---
title: STT
sidebar_position: 8
---

# STT

Charivo's STT layer combines `@charivo/stt` with a concrete transcriber.

For production browser apps, use the remote transcriber with a server route
backed by `@charivo/server/openai` or `@charivo/server/gemini`.

## Recommended Stack

```text
@charivo/stt
@charivo/stt/remote
your /api/stt route
@charivo/server/openai or @charivo/server/gemini
```

The browser records locally. The backend handles transcription.

## Basic Setup

```ts
import { createCharivo } from "@charivo/core";
import { createSTTManager } from "@charivo/stt";
import { createRemoteSTTTranscriber } from "@charivo/stt/remote";

const charivo = createCharivo({
  stt: createSTTManager(
    createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" }),
  ),
});

await charivo.getSTTManager()?.start({ language: "en" });
const text = await charivo.getSTTManager()?.stop();
```

## Transcriber Choices

### Remote

- `@charivo/stt/remote`
- records in the browser and sends audio to your route as multipart form data
- best default for production browser apps

### Direct OpenAI

- `@charivo/stt/openai`
- useful for local development and testing
- exposes credentials to the browser

### Direct Gemini

- `@charivo/stt/gemini`
- useful for local development and testing
- exposes credentials to the browser

**Limitations:**

- the `language` hint is optional and only a soft nudge — a wrong hint does not override what the model actually hears
- one request per utterance, with no streaming — the live transcription model (`gemini-3.5-transcribe-live`) is WebSocket-only, `generateContent` rejects it with a 400, and it is served by `@charivo/stt/gemini-live` instead, so `defaultModel` must not point at it
- Gemini's free-tier rate limit surfaces as a 429 wrapped in a provider error

### Browser-Native

- `@charivo/stt/web`
- built on the Web Speech API
- useful for prototypes and zero-server flows
- browser support varies

### Streaming (OpenAI Realtime)

- `@charivo/stt/openai-realtime`
- WebRTC transcriber backed by an OpenAI Realtime transcription session (`gpt-realtime-whisper`)
- credential-free: the app supplies a `bootstrap(request) => Promise<{ answerSdp }>` function that owns credentials and the SDP exchange
- transcript deltas stream live as the user speaks, each carrying its own spacing
- drafts relay via `stt:partial` by plain concatenation of those deltas
- on `stop()`, the transcriber disables the mic, sends a single `input_audio_buffer.commit`, and resolves with the joined authoritative final transcript

**Limitations:**

- no server VAD — press-to-start / press-to-stop only
- language auto-detects unless `STTOptions.language` is set
- calling `stop()` before connect finishes cancels the pending start and resolves with an empty transcript, releasing the microphone and any partially-opened connection; the pending `start()` call itself rejects
- a stop that times out also rejects `stop()` and emits `stt:error` — a partial draft is never returned as a successful `stt:stop`
- a small RTP-vs-data-channel tail race means the last fraction of a second of audio may rarely be truncated
- packaged Electron apps behind UDP-blocking proxies may fail to establish the WebRTC connection

### Streaming (Gemini Live)

- `@charivo/stt/gemini-live`
- WebSocket transcriber backed by a Gemini Live API session (`gemini-3.5-transcribe-live`)
- no key-bearing helper ships: the app supplies a `bootstrap(request) => Promise<{ url, token }>` function that owns the credentials and mints the single-use ephemeral token whose setup pins the model, the `TEXT` response modality, and manual VAD. Unlike the WebRTC path's SDP answer, that token is itself a credential — the browser holds it for the life of one recording
- `url` must be the Live API's `BidiGenerateContentConstrained` websocket endpoint (the ephemeral-token one), with scheme `ws:` or `wss:` (the transcriber rejects any other scheme) and no fragment (the native `WebSocket` constructor rejects one); the transcriber parses `url` and adds `access_token` as a query parameter, so an existing query string on it survives
- the microphone is decimated to 16 kHz mono PCM in an `AudioWorklet`
- manual VAD: the client brackets one activity per recording with `activityStart`/`activityEnd`, so the server never segments it and the whole recording is transcribed as one turn
- the token is what makes that stick, so pinning manual VAD in it is a requirement rather than a detail: its `bidiGenerateContentSetup` *replaces* the setup frame the transcriber sends rather than merging with it, and a bootstrap that leaves manual VAD out silently loses the recording — server VAD cuts the audio at every pause, each transcription replaces the running snapshot instead of extending it, and `stop()` then resolves with the last segment alone or times out waiting for a final that arrived after `activityEnd`
- each `stt:partial` is the whole recording so far rather than a delta, emitted only when it changes
- on `stop()` the tail buffered in the capture worklet is drained, `activityEnd` goes out, and the single final resolves the transcript (measured at +253 ms after `activityEnd`)

**Limitations:**

- no server VAD — press-to-start / press-to-stop only
- a partial may be *revised*, not only extended, so a UI must replace its draft rather than append to it; the strict prefix monotonicity `@charivo/stt/openai-realtime` gives does not hold here
- `STTOptions.language` is handed to your `bootstrap` function rather than sent over the socket, so pinning it is the minting route's job (the demo route puts it in `inputAudioTranscription.languageCodes`)
- a `stop()` with no final within 5 seconds rejects and emits `stt:error` — a partial draft is never returned as a successful `stt:stop`. A recording the server heard no speech in is that case: it produces no transcript frame at all (measured), so silence ends in a rejected `stop()` rather than an empty transcript
- calling `stop()` before connect finishes cancels the pending start and resolves with an empty transcript, releasing the microphone and any partially-opened connection; the pending `start()` call itself rejects
- nothing is banked mid-recording, so losing the connection loses the whole utterance — parity with `@charivo/stt/openai-realtime`, which likewise finalizes with exactly one commit at stop
- Google documents a Live API *connection* lifetime of around 10 minutes (shorter than the 15-minute audio-only *session* limit). Not measured here. This transcriber opens one connection per recording and does not resume sessions — it reads no `sessionResumptionUpdate` — so that connection lifetime is what bounds a single recording

## What `@charivo/stt` Owns

- recording lifecycle
- interaction with the transcriber implementation
- STT lifecycle and error events back into core
- relaying interim transcript drafts (`stt:partial`) from streaming transcribers
- surfacing a transcriber's mid-session failure: no event is pushed when it happens — the failure reaches the app the next time it calls `stop()`, which rejects and emits `stt:error`

`STTManager` intentionally uses `setEventEmitter(...)` rather than the full
event bus.

## Provider Route

The remote transcriber usually pairs with `@charivo/server/openai` or
`@charivo/server/gemini` on the server:

```ts
const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: "whisper-1",
});

const text = await provider.transcribe(audioBlob, {
  language: "en",
});
```

```ts
const geminiProvider = createGeminiSTTProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  defaultModel: "gemini-3.5-transcribe",
});
```

## Alternatives

- Use `@charivo/stt/web` when you want the fewest moving parts and browser support is good enough.
- Use `@charivo/stt/openai` when you are testing direct vendor behavior.
- Use `@charivo/stt/gemini` when you are testing the Gemini transcriber directly.
- Move to [Realtime](./realtime.md) when you want continuous session-based voice interaction instead of turn-based transcription.

## References

- [STT Package README](https://github.com/zeikar/charivo/blob/main/packages/stt/README.md)
