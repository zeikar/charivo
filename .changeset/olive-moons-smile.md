---
"@charivo/core": minor
"@charivo/llm": patch
"@charivo/stt": patch
"@charivo/tts": patch
---

Surface the reason a remote route rejected a request. The STT and TTS remote
clients reported only the HTTP status line, so a provider rate limit or outage
reached the caller as "Internal Server Error" with the route's own explanation
discarded. All three remote clients now read the error body through a new
`readResponseErrorMessage` helper in `@charivo/core`, which prefers a route's
`details` field, falls back to `error`, then to the status line — and still
propagates an abort or timeout that lands mid-body instead of flattening it
into a message. This replaces the one-off copy that lived in the LLM client.
