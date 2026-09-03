---
"@charivo/stt": minor
"@charivo/server": minor
---

Add a `@charivo/stt/gemini` subpath with `createGeminiSTTProvider` and
`createGeminiSTTTranscriber`, posting audio inline to Gemini's
`models/{model}:generateContent` endpoint over `fetch` with a default model of
`gemini-3.5-transcribe`. `STTOptions.language` is optional and only a soft
hint — the model transcribes what it hears even when the hint is wrong. The
request runs behind a `timeoutMs` that defaults to 30s and also covers reading
the response body. `@charivo/server/gemini` re-exports `createGeminiSTTProvider`
alongside the existing LLM, TTS, and realtime providers.
