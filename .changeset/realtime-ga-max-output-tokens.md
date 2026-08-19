---
"@charivo/core": minor
"@charivo/realtime": minor
"@charivo/server": patch
---

Send the realtime output cap under its GA name, and drop the session
`temperature` the GA API no longer accepts.

Setting `maxTokens` on a realtime session made the session unmintable: every
path sent it as `max_response_output_tokens`, the Realtime beta's name for it,
and the GA API rejects that outright with
`Unknown parameter: 'session.max_response_output_tokens'`. Nothing in the repo
set `maxTokens` until the demos began pinning an output cap server-side, so the
wrong name sat unexercised.

**@charivo/core (minor)**

- `RealtimeSessionConfig.temperature` is removed. The GA session schema has no
  `temperature` — it rejects the parameter the same way, so the field could
  only ever break a session that set it.

**@charivo/realtime (minor)**

- `buildRealtimeSessionConfig(...)` no longer projects `temperature`.
- The OpenAI client's `session.update` and the dev bootstrap's client-secret
  request send `max_output_tokens`.
- The agents adapter carries the cap through `providerData` instead of a
  `maxResponseOutputTokens` field. The SDK rebuilds `session.update` from an
  allowlist of fields it maps, so a key it does not know is dropped before it
  reaches the wire; `providerData` is spread raw into the session payload.

**@charivo/server (patch)**

- The OpenAI realtime provider sends `max_output_tokens` on both the WebRTC and
  the agents (client-secret) path, so a session pinning `maxTokens` mints again.
