---
"@charivo/realtime": minor
"@charivo/server": minor
---

Make `inputAudioTranscription` mean the same thing on every realtime provider:
off unless asked, with `enabled` as the switch. `{ enabled: true }` now turns
transcription on with the provider's default model — the OpenAI provider and
transports used to ignore it silently without a `model`, because OpenAI
requires one; the default is `gpt-4o-mini-transcribe`. `{ model }` still
implies on where the provider offers a choice, and `{ enabled: false }` still
turns it off. The Gemini provider no longer requests input transcription unless
asked.
