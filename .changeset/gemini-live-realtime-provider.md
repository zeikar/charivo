---
"@charivo/core": minor
"@charivo/realtime": minor
"@charivo/server": minor
---

Add Gemini Live as a second realtime provider.

`@charivo/server/gemini` mints constrained ephemeral tokens: the API key stays
in a request header, and the token carries a full `bidiGenerateContentSetup`
plus model and voice allow-lists, so a token cannot be repointed at another
model. `@charivo/realtime/gemini` is the matching browser WebSocket transport —
16 kHz capture, a 24 kHz playback scheduler with a lip-sync tap, barge-in, tool
calls, and transcription mapping. `@charivo/core` gains the
`GEMINI_LIVE_ADAPTER` constant, and the remote client resolves it for
`provider: "gemini"` with `transport: "websocket"`.

Session resumption, `goAway` handover, connection rotation, context-window
compression, and `updateSession()` are not implemented yet; the transport
rejects `updateSession()` explicitly rather than pretending to apply it.
