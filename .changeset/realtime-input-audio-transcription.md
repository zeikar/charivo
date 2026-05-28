---
"@charivo/core": minor
"@charivo/realtime": minor
"@charivo/server": minor
---

Expose inputAudioTranscription on RealtimeSessionConfig (model + enabled)

`RealtimeSessionConfig` now accepts an optional `inputAudioTranscription` field for controlling user-microphone transcription on the provider:

- `inputAudioTranscription: { model: "gpt-4o-mini-transcribe" }` selects a cheaper transcription model.
- `inputAudioTranscription: { model: "gpt-4o-transcribe" }` selects the higher-quality option.
- `inputAudioTranscription: { enabled: false }` disables transcription entirely (useful when the UI never displays the user transcript).

Default behavior is unchanged when the field is unset — providers continue with their existing server-side defaults. The wire shape lands under `audio.input.transcription` per the OpenAI Realtime GA contract, and applies consistently across the legacy OpenAI WebRTC client, the OpenAI Agents SDK transport, and the server provider. Model strings are pass-through; unknown values surface as upstream errors from OpenAI rather than being validated locally. Example known values: `whisper-1`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`.
