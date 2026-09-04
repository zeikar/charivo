---
"@charivo/stt": minor
---

Add `@charivo/stt/gemini-live`, a streaming transcriber over the Gemini Live API
(`gemini-3.5-transcribe-live`, manual VAD) with `onPartial` snapshots and a
consumer-supplied token bootstrap. The app injects
`bootstrap(request) => Promise<{ url, token }>` and mints the single-use
ephemeral token itself, so no credential lives in the package. The client
brackets one activity per recording with `activityStart`/`activityEnd`, so the
server never segments it: each partial is the whole recording so far and may be
revised rather than only extended, and `stop()` drains the capture worklet,
closes the activity, and resolves with the single final transcript.
