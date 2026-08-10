---
"@charivo/core": minor
---

`userSay()` now stops any active TTS playback at the start of a turn, before
the LLM can project a new expression via a tool call. Previously, when a new
turn started while the prior turn's speech was still playing, the TTS
manager's own internal stop (inside `speak()`) would emit `tts:audio:end` for
the OLD utterance after the new expression had already been applied, causing
consumers that release-on-audio-end (like `@charivo/render`) to clear the new
expression before its own speech even started. The stop is a no-op when no
TTS manager is attached, and a failure to stop stale audio no longer aborts
the turn — it's surfaced via the existing `tts:error` event instead.
