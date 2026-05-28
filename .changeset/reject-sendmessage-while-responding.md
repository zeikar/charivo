---
"@charivo/realtime": minor
---

Reject sendMessage while a realtime response is in progress

`RealtimeManager.sendMessage()` now throws `CharivoStateError` when
`state.response.status === "responding"`. Previously the call was forwarded
to the underlying transport client, which either silently dropped it (legacy
OpenAI client) or caused OpenAI to auto-cancel the in-progress response and
start a new one — paying for tokens that were immediately discarded.

**Behavior/contract change:** callers who relied on silent-drop or
auto-cancel behavior must now call `interrupt()` first and wait for it to
resolve before sending a new message.

The guard order in `sendMessage` is: session active → connection connected →
response not in progress.

`sendAudioChunk` is intentionally unaffected. Audio chunks are continuous
streaming input and overlap is handled by OpenAI VAD/turn-detection on the
server side.
