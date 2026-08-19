---
"@charivo/realtime": patch
---

Fix two agents-adapter defects that only surface on the second turn of a
realtime session.

**Lip-sync stopped after the first reply.** Analysis is paused at every playback
end, and resuming it hung off the SDK's `audio_start` event. That event is
derived from a transport `audio` event which only the SDK's WebSocket transport
emits, so a WebRTC session never received it: the analyzer was paused when the
first reply finished and nothing ever resumed it. Audio kept playing to a still
mouth for the rest of the session, and because `audioOutputActive` never became
true, the visibility and pageshow resume paths were dead too. Playback segments
now open on `output_audio_buffer.started` — the counterpart to the buffer events
that already closed them, and on WebRTC the only start signal that arrives. Both
signals feed one idempotent path, so a WebSocket transport still reports exactly
one start, and teardown clears the open-segment flag so a reconnect during
playback does not swallow the next session's first start.

**A turn ending without text stranded the response lock.** The client suppresses
the completion event for the first `agent_end` of a tool-using turn, where the
real reply is still coming. It detected that sub-cycle by the turn being empty,
so any turn that simply ended without text — a tool that failed, a reply the
model never spoke — was swallowed the same way. `RealtimeManager` releases its
send lock on that event, so it stayed locked and every later `sendMessage` threw
`Response already in progress` until an interrupt or a reconnect. The suppression
is now gated on `response.done` actually reporting a function call. A genuinely
empty turn completes with empty text rather than resurrecting the previous
turn's message from history.
