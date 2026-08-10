---
"@charivo/tts": patch
---

Fixed hangs and a stale-event hazard when `stop()` interrupts an in-flight
`speak()` call, for both playback modes:

- Stateless-audio (the `generateAudio`-based "audio" playback mode): stopping
  a still-playing utterance left that `speak()` call's promise pending
  forever, because `stop()` clears the audio element's `onended`/`onerror`
  handlers before they can fire. `stop()` now settles that pending promise
  itself.
- Web Speech mode: the player owns and settles that promise itself
  (`cancel()` triggers `onend`/`onerror`), but that callback can arrive late
  — even after a newer utterance has already replaced it — or never fire at
  all. `stop()` now also settles this path proactively, and a late-arriving
  callback from a canceled utterance can no longer end a session that has
  since moved on to a newer one.

Both settle by resolving rather than rejecting: a deliberate stop is a
cancellation, not a playback failure.
