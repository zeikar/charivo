---
"@charivo/core": minor
"@charivo/stt": minor
---

Add live (as-you-speak) streaming transcription to `@charivo/stt`.

- core: an optional `STTTranscriber.onPartial` hook and a new `stt:partial`
  event (cumulative draft snapshot). Fully additive.
- stt: a new `@charivo/stt/openai-realtime` subpath with an OpenAI Realtime
  transcription (WebRTC, `gpt-realtime-whisper`) streaming transcriber that takes
  an app-injected bootstrap. Transcript deltas stream live via `stt:partial` as
  you speak; `stopRecording()` disables the mic, sends a single commit, and
  returns the authoritative final transcript. Mid-session failures surface
  through the existing `stt:error` path. Batch transcribers are unchanged.
