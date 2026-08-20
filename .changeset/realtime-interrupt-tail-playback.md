---
"@charivo/realtime": patch
---

Stop the sound when the direct OpenAI transport is interrupted during tail
playback.

`interrupt()` returned early unless a response was still generating, so it did
nothing at all once `response.done` had arrived — the exact window where playback
is still draining and an interrupt is what a caller wants. Cancelling stops
generation; clearing the output buffer is what stops the sound, and that is now
sent whenever audio output is open, independently of whether there is a response
left to cancel. The agents transport already did this.
