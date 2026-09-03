---
"@charivo/tts": minor
"@charivo/server": minor
---

Add a `@charivo/tts/gemini` subpath with `createGeminiTTSProvider` and
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
