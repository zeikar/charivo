---
"@charivo/realtime": patch
---

Build the Gemini Live socket URL by parsing the bootstrap `url` instead of
concatenating the token onto it, matching `@charivo/stt/gemini-live`. A
bootstrap `url` that carries its own query string previously absorbed
`?access_token=...` into the last parameter's value; it now keeps its
parameters and gains the token as one more. The url is also validated before
the token is attached, so a bootstrap misconfiguration reads as one: an
unparseable url and a scheme that is not `ws:` or `wss:` are rejected with
their own messages. That scheme check is a small tightening — the native
`WebSocket` constructor used to map `http:`/`https:` for you.
