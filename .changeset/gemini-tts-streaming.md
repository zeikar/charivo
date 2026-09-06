---
"@charivo/core": minor
"@charivo/tts": minor
"@charivo/server": minor
---

Add an optional streaming path alongside buffered TTS. `@charivo/core` adds
`TTSPcmStream` (a `ReadableStream<Uint8Array>` body plus a `pcm-s16le` format)
and optional `generateAudioStream` / `generateSpeechStream` methods to
`TTSPlayer` and `TTSProvider`; a player implementing `generateAudioStream`
still satisfies `"audio"` playback mode. `@charivo/tts`'s manager prefers the
streamed method when a player has it, scheduling PCM into Web Audio as it
arrives instead of waiting for one finished buffer, with the same lip-sync
analysis, `stop()`, and `tts:audio:start`/`tts:audio:end` lifecycle as the
buffered path; a player without `generateAudioStream` is unaffected and keeps
using `generateAudio`. `createRemoteTTSPlayer` takes a new opt-in `streaming`
option that requests `audio/pcm` and rejects any answer that is not mono PCM;
the underlying fetch enforces a connect-and-headers deadline and a 10s
inactivity deadline, deliberately with no total deadline so a long reply is
never cut for being long. `GeminiTTSProvider` (from `@charivo/tts/gemini`,
re-exported by `@charivo/server/gemini`) adds `generateSpeechStream` over
Gemini's `streamGenerateContent` endpoint, delivering first audio in roughly
1.1-1.4s regardless of text length; `generateSpeech` is unchanged. OpenAI's
provider stays buffered this release.
