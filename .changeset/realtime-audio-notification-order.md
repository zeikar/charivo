---
"@charivo/realtime": patch
---

Realtime audio output now delivers `tts:audio:start` to every listener before the `tts:audio:end` that a listener caused by interrupting inside the start notification, so a later listener no longer sees an end without its start.
