# @charivo/tts

Stateful TTS manager for Charivo.

This package coordinates a `TTSPlayer`, audio playback lifecycle, and lip-sync
events. It works with browser-native speech, remote TTS APIs, and direct OpenAI
and Gemini players.

`"audio"` playback mode is satisfied by either audio path a player
implements. When a player has `generateAudioStream()`, the manager prefers
it: it schedules the incoming PCM into Web Audio as it arrives, tapping the
shared core lip-sync analyzer (`createLipSyncAnalyzer` from `@charivo/core`)
off that same playback graph. Otherwise it plays a `generateAudio()` buffer
through the `<audio>` element it creates and analyzes the same way. Either
path emits `tts:lipsync:update`. For `"web-speech"` mode, lip-sync is
simulated from the spoken text instead — there is no audio to analyze.

Concrete players should declare `playbackMode` (`"audio"` or `"web-speech"`)
and can optionally declare `audioMimeType` so the manager does not need to rely
on constructor-name inference.

`"audio"` playback mode requires the player to implement `generateAudio()` or
`generateAudioStream()`, since the manager needs one of them to build the
playback it analyzes; `createTTSManager(player)` throws an explicit error if a
player declares `"audio"` mode with neither. Players that only implement
`speak()` (no `generateAudio()` or `generateAudioStream()`, e.g. the Web
Speech API) must use `"web-speech"` mode instead.

## Install

```bash
pnpm add @charivo/tts
```

## Usage

```ts
import { createTTSManager } from "@charivo/tts";
import { createRemoteTTSPlayer } from "@charivo/tts/remote";

const ttsManager = createTTSManager(
  createRemoteTTSPlayer({ apiEndpoint: "/api/tts" }),
);

await ttsManager.speak("Hello", { voice: "marin" });
```

## Exports

- `createTTSManager(player)`
- `@charivo/tts/remote`: `createRemoteTTSPlayer(config)`, the production
  browser player that posts to your own API route. `config.streaming` is
  opt-in: off by default, since an unconditionally streaming player would
  break any route that only answers a finished container, and this player
  cannot fall back to the buffered path after a non-PCM answer without paying
  for a second synthesis. Enabled, it requests `audio/pcm` and expects
  `pcm-s16le`, mono-only PCM back, delivered as it is produced rather than one
  fixed-length payload; requests enforce a connect-and-headers deadline plus a
  separate 10s inactivity deadline once the body starts, and deliberately no
  total deadline, so a long reply is never cut for being long.
- `@charivo/tts/openai`: `createOpenAITTSPlayer(config)` (browser player,
  dev/testing only) and, for server-side use, `createOpenAITTSProvider(config)`,
  `OpenAITTSProvider`, `type OpenAITTSConfig`
- `@charivo/tts/gemini`: `createGeminiTTSPlayer(config)` (browser player,
  dev/testing only) and, for server-side use, `createGeminiTTSProvider(config)`,
  `GeminiTTSProvider`, `type GeminiTTSConfig`. The provider wraps Gemini's raw
  PCM (`audio/l16`) response as a 16-bit WAV file; `rate` and `pitch` are
  ignored, since the API has no speed or pitch control; voices are Google's
  prebuilt names (default `Kore`). The text is sent behind a fixed synthesis
  preamble, and a 5xx or a text-only answer is retried once within the same
  `timeoutMs`, per Google's documented mitigations. It calls
  `models/{model}:generateContent` because that is the shape measured working
  and the simpler one-shot request for one utterance per call, even though
  Google now labels it legacy (still fully supported). `generateSpeech`'s
  `timeoutMs` defaults to 90s, since synthesis takes a fixed startup cost plus
  roughly 0.75x the audio's length; that default suits the direct player and
  callers that own their own deadline. A route behind `@charivo/tts/remote`
  must pass a `timeoutMs` under that player's fixed 30s (the demo's
  `TTS_GEMINI_ROUTE_TIMEOUT_MS` is 25,000) and cap its text as the real
  latency control (the demo's
  `TTS_GEMINI_MAX_TEXT_CHARS` is 400). `generateSpeechStream` calls the
  `:streamGenerateContent?alt=sse` sibling of the same endpoint and returns a
  `TTSPcmStream` instead, delivering its first audio in roughly 1.1-1.4s
  regardless of text length; it is not retried once its first chunk has
  reached the caller, since a retry would replay speech already played, and it
  shares the same text cap because a long enough stream can end on a spurious
  `SAFETY` finish reason instead of completing.

## Event Bridge

`TTSManager` accepts an emit-only event bridge through `setEventEmitter(...)`.
It emits TTS lifecycle and lip-sync events back into core, but it does not
subscribe to upstream Charivo events.

When connected, the manager emits:

- `tts:audio:start`
- `tts:lipsync:update`
- `tts:audio:end`

## Audio Lifecycle

- `stop()` — stops active playback: on the buffered path this pauses and
  discards the `<audio>` element; on the streaming path it flushes whatever
  PCM is already queued in Web Audio and aborts the upstream request. If it
  interrupts an in-flight `speak()` call, that call's promise settles as part
  of the stop instead of being left pending: a deliberate stop is treated as
  a cancellation, not a failure, so it resolves rather than rejects. `stop()`
  also cancels a `speak()` call still starting up — the pre-speech stop, or
  audio synthesis. On the buffered path that cancelled call resolves silently
  and never begins playback, whether or not it had already opened an audio
  session, so a resolved `speak()` is not proof audio played there. Streamed
  playback cannot promise that much: its audio session opens on the first
  scheduled buffer, so a stop from that same `tts:audio:start` listener can
  land after a few milliseconds of sound already played — the call still
  resolves and emits exactly one `tts:audio:end`. A newer `speak()` cancels a
  still-starting older one the same way.
- `prepareAudio()` — creates the lip-sync `AudioContext` up front, and, for a
  player that streams, warms the streamed playback context too. Call it from
  a user-gesture handler before the first `speak()` so mobile browsers that
  require audio to start from a gesture do not block playback; on a browser
  without sticky activation (Safari), skipping it before a streaming
  `speak()` fails that call with `CharivoStateError` instead of playing.
- `dispose()` — releases lip-sync audio resources and unsubscribes browser
  lifecycle listeners. Call `stop()` first if speech is in-flight; `dispose()`
  does not stop playback. `Charivo.dispose()` calls this automatically for an
  attached TTS manager — call it directly only if your app tears a
  `TTSManager` down outside `Charivo.dispose()`.
