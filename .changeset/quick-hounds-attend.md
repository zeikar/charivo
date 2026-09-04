---
"@charivo/tts": patch
---

Stop mislabeling OpenAI TTS audio as WAV. The OpenAI player now declares
`audio/mpeg`, which is what the API actually returns — `OpenAITTSProvider`
sends `format: "wav"`, but the SDK parameter is `response_format`, so that
field never reached the request and the mp3 default came back under a WAV
label. The remote player no longer hardcodes a container either: it adopts the
`Content-Type` its endpoint reports, so a server backed by OpenAI (MPEG) and
one backed by Gemini (WAV) are both labeled correctly.
