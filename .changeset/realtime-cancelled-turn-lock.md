---
"@charivo/realtime": patch
---

Stop a cancelled turn from releasing the replacement turn's send lock.

Interrupting a response and immediately sending a replacement let the cancelled
turn's late lifecycle events be credited to the replacement, which released its
send lock and admitted a duplicate send. Both built-in transports now condemn a
response the wire proves is in flight when `interrupt()` runs — any acknowledged
response, client-requested or created by server VAD — and drop that turn's
assistant lifecycle events while the suppression holds. The low-level transport
also covers a client-requested response interrupted before its acknowledgement,
and repeated interrupt-and-replace cycles, which a single suppression flag could
not survive.

A cancel that loses the race to server-side completion no longer surfaces as a
transport error; it was reaching the manager's error path and freeing the
replacement's lock by another route.

Tool events stay live across an interrupt and audio events keep reporting real
playback. The windows that remain uncovered are listed in the realtime guide.
