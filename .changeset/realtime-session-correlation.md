---
"@charivo/core": minor
"@charivo/realtime": minor
---

Make `@charivo/realtime` session-aware and drop library-owned OpenAI defaults.

Breaking changes:

- `buildRealtimeSessionConfig()` no longer fills `provider` or `model`. Pass
  them explicitly on `startSession(...)` or rely on your transport client's
  local defaults.
- `RealtimeState.session.config.provider` / `.model` may now be `undefined`
  if the caller did not specify them.

Additive:

- new `sessionId` threaded through `RealtimeLogger` context and `realtime:usage`
  payloads. Same id persists across `updateSession(...)` and reconnects within
  the same session.
- logger contexts now include the active `sessionId`. If your logger already
  sets a `sessionId` field, the manager overrides it.
