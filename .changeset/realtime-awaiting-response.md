---
"@charivo/core": minor
"@charivo/realtime": minor
---

Expose whether a reply is still expected on `RealtimeState`.

`sendMessage` refuses while a turn is in flight, but nothing in the state said
so. `response.status` looked like the answer and is not: it misses the stretch
between a message going out and its reply starting to stream, so a caller that
checked it still hit `Response already in progress` — as an exception, after the
fact, with no way to have known.

`RealtimeState.awaitingResponse` reports exactly the condition `sendMessage`
refuses on. It is derived on read from the send lock and the response status
rather than stored, and the refusal itself now reads the same expression, so the
field cannot drift from the behaviour it advertises.

With this and `audioPlaying`, every refusal is predictable ahead of the call.
