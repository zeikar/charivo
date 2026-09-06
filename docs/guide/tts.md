---
title: TTS
sidebar_position: 7
---

# TTS

Charivo's TTS layer combines `@charivo/tts` with a concrete player.

For production browser apps, use the remote player with a server route backed
by `@charivo/server/openai` or `@charivo/server/gemini`.

## Recommended Stack

```text
@charivo/tts
@charivo/tts/remote
your /api/tts route
@charivo/server/openai or @charivo/server/gemini
```

## Basic Setup

```ts
import { createCharivo } from "@charivo/core";
import { createTTSManager } from "@charivo/tts";
import { createRemoteTTSPlayer } from "@charivo/tts/remote";

const charivo = createCharivo({
  tts: createTTSManager(createRemoteTTSPlayer({ apiEndpoint: "/api/tts" })),
});
```

## Player Choices

### Remote

- `@charivo/tts/remote`
- production-oriented browser path
- sends text and voice options to your own API route

### Direct OpenAI

- `@charivo/tts/openai`
- useful for local development and testing
- exposes credentials to the browser

### Direct Gemini

- `@charivo/tts/gemini`
- useful for local development and testing
- exposes credentials to the browser

### Browser-Native

- `@charivo/tts/web`
- built on the Web Speech API
- useful for prototypes and zero-server flows
- voice behavior depends on browser and OS support

## What `@charivo/tts` Owns

- playback lifecycle
- lip-sync analysis and event emission
- player capability normalization through `playbackMode` and optional `audioMimeType`

`TTSManager` intentionally uses `setEventEmitter(...)`, not the full event bus.
It emits TTS lifecycle and lip-sync events back into core, but it does not
subscribe to upstream Charivo events.

`"audio"` playback mode requires the player to implement `generateAudio()` or
`generateAudioStream()`; `createTTSManager(player)` throws an explicit error
if it has neither. When a player implements `generateAudioStream()`, the
manager prefers it: it schedules the incoming PCM into Web Audio as it
arrives and taps the shared core lip-sync analyzer
(`createLipSyncAnalyzer` from `@charivo/core`) off that same playback graph.
Otherwise it plays `generateAudio()`'s finished buffer through an `<audio>`
element it creates and analyzes the same way. Either path emits
`tts:lipsync:update`. Players that only implement `speak()` (e.g. the Web
Speech API) must use `"web-speech"` mode, whose lip-sync comes from a
text-driven simulation instead of real audio analysis.

`createTTSManager` guarantees `prepareAudio`, `setEventEmitter`, and
`dispose`, so calls on its result need no `?.`. A variable typed as the core
`TTSManager` still does — a third-party manager may omit them.

Call `ttsManager.prepareAudio()` from a user-gesture handler before the
first `speak()` so the lip-sync `AudioContext` starts cleanly on mobile
browsers. For a player that streams, the same call also warms the streamed
playback context; on a browser without sticky activation (Safari), skipping
it before a streaming `speak()` rejects that call with `CharivoStateError`
instead of playing, rather than merely leaving lip-sync degraded. Call
`ttsManager.dispose()` to release lip-sync audio resources if your app tears a
`TTSManager` down outside `Charivo.dispose()`, which already calls it
automatically.

## Stopping and Interrupting

`ttsManager.stop()` settles an in-flight `speak()` call it interrupts instead
of leaving it pending — a deliberate stop resolves rather than rejects.
`Charivo.userSay(text)` calls this at the start of every turn, so a reply
that's still speaking gets stopped before the next turn's LLM response and
TTS begin. Under the latest-wins `userSay(text)` contract that same stop is
how a superseding turn silences the turn it replaces, and the superseded
`userSay(text)` call resolves rather than rejecting. On the streaming path,
stopping an in-flight utterance flushes whatever PCM is already queued in Web
Audio and aborts the upstream request, the same way pausing and discarding an
`<audio>` element stops the buffered path.

`stop()` also cancels a `speak()` call still starting up — the pre-speech
stop, or audio synthesis. On the buffered path a cancelled call never begins
playback afterward, whether or not it had already opened an audio session: a
reentrant stop from the `tts:audio:start` listener still sees the session
close before anything is handed to the speakers. Streamed playback cannot
promise that much, because there `tts:audio:start` follows the first
scheduled buffer — a stop from that listener can land after a few
milliseconds of sound. It still settles the call and emits exactly one
`tts:audio:end`. An app that wants to cut a character off mid-turn should
call `charivo.interrupt()` rather than `ttsManager.stop()` directly:
`interrupt()` stops the TTS *and* cancels the turn coherently (aborting its
LLM request and announcing `turn:cancelled`), where a bare `ttsManager.stop()`
silences the audio but leaves the turn running to completion behind it.

## Streaming

A player can implement `generateAudioStream(text, options, signal)` alongside
or instead of `generateAudio()`, returning a `TTSPcmStream`: a
`ReadableStream<Uint8Array>` body plus a `format` that is always
`{ encoding: "pcm-s16le", sampleRate, channels }`, whatever the vendor's own
wire format was. Aborting `signal`, or cancelling the returned stream's body,
must cancel the upstream request. A player without `generateAudioStream()`
is unaffected — it keeps working over `generateAudio()` exactly as before.

`createRemoteTTSPlayer({ streaming: true })` from `@charivo/tts/remote` turns
this on for the remote player, which otherwise stays on the buffered path.
It is opt-in because an unconditionally streaming player would break any
route that only ever answers a finished container, and this player cannot
fall back to the buffered path after a non-PCM answer without paying for a
second synthesis. When enabled it sends `Accept: audio/pcm` on the request;
your route contract is to answer `Content-Type: audio/pcm; rate=<sampleRate>;
channels=<channels>` with `pcm-s16le` bytes in the body as they are produced,
rather than one fixed-length payload, and mono only — the player rejects any
other channel count as a configuration error rather than trying to play it.
Once such a response's headers have gone out, a failure while writing the
body can no longer become a JSON error on your route; it has to surface to
the player as an error on the stream itself.

The remote player enforces two deadlines on a streaming response: the usual
connect-and-headers deadline, and a separate inactivity deadline (10s) armed
per upstream read once the body starts arriving. The remote player itself sets
deliberately no total deadline on the streamed body — one would silently
become a cap on how long a reply is allowed to be. The provider behind the
route is a different story: its own `timeoutMs` does bound the whole streamed
body, headers through last byte (see below), so a long enough reply still
ends in `CharivoTimeoutError` there.

`tts:audio:start` fires once the first samples actually reach the speakers —
when the scheduler starts the first scheduled buffer — not when the stream
opens or the first bytes are read, the same "audio is actually playing"
meaning the buffered path already gives that event.

OpenAI's provider stays buffered this release: the `openai` SDK version
`@charivo/tts` currently depends on has no `stream_format` option on its
speech request, so `@charivo/tts/openai` and `/api/tts` are untouched by any
of the above.

## Provider Route

The remote player usually pairs with `@charivo/server/openai` or
`@charivo/server/gemini` on the server:

```ts
const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultVoice: "marin",
  defaultModel: "gpt-4o-mini-tts",
});

const audio = await provider.generateSpeech(text, {
  voice: "marin",
  rate: 1,
});
```

```ts
const geminiProvider = createGeminiTTSProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  // `@charivo/tts/remote` gives up at 30s, so the server must give up first.
  // On the streaming path this same 25s also caps the streamed body itself,
  // at roughly 80s of audio (Gemini delivers ~3.5x realtime).
  timeoutMs: 25_000,
});

const stream = await geminiProvider.generateSpeechStream(text, {
  voice: "Kore",
});
```

A text cap is the real latency control on top of that deadline for the
buffered path — the demo caps at 400 characters via
`TTS_GEMINI_MAX_TEXT_CHARS`. The provider's 90s default `timeoutMs` is only
for the direct player and callers that own their own deadline. The cap stays
for `generateSpeechStream` too, for a different reason: past some length a
stream ends on a spurious `SAFETY` finish reason instead of completing —
measured, a 2,358-character text streamed 96.60s of audio before terminating
with `SAFETY` (reproduced twice), a 1,182-character text completed with
`STOP`, and the same 2,358-character text completes fine over the
non-streaming `generateSpeech`.

### Gemini TTS limitations

- the provider wraps Gemini's raw PCM response as a 16-bit WAV file
- `rate` and `pitch` are ignored, since the API has no speed or pitch control
- voices are Google's prebuilt names, not OpenAI-style voice IDs
- the text is sent behind a fixed synthesis preamble, and a 5xx or a
  text-only answer is retried once within the configured `timeoutMs`
- `generateSpeech` latency is roughly one second of fixed startup cost plus
  about 0.7x the audio length, so short replies do not get proportionally
  cheaper: measured 3.2s for 3.0s of audio (56 characters) against 13.5s for
  18.0s (278 characters); `generateSpeechStream` instead delivers its first
  audio in roughly 1.1-1.4s regardless of text length, and the same
  `timeoutMs` bounds its whole streamed body rather than just the
  connect-and-headers phase, so a reply that outlasts it errors mid-utterance
  instead of merely failing to start

## Alternatives

- Use `@charivo/tts/web` when you want no backend and browser variability is acceptable.
- Use `@charivo/tts/openai` when you are debugging OpenAI TTS behavior directly.
- Use `@charivo/tts/gemini` when you are debugging Gemini TTS behavior directly.
- Skip TTS when text chat is enough for the current experience.

## References

- [TTS Package README](https://github.com/zeikar/charivo/blob/main/packages/tts/README.md)
