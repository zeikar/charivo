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

`RealtimeState.awaitingResponse` reports that condition. It is derived on read
from the send lock and the response status rather than stored, the refusal reads
the same expression, and every transition publishes through `realtime:state`, so
the field cannot drift from the behaviour it advertises.

It covers the response-in-progress refusal only; an inactive or reconnecting
session is rejected on its own terms, which `session.status` and `connection`
already report.
