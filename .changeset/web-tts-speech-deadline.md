---
"@charivo/tts": minor
---

`@charivo/tts/web`: `speak()` now rejects with a timeout error if the browser never reports the end of an utterance (some browsers, such as Chrome with some voices, never fire `end` or `error`). Previously `speak()` never settled in that case. The deadline is a deliberately generous hang guard: 10 s plus 300 ms per character, with the per-character part divided by the utterance's rate (so rate 0.5 allows 600 ms per character). It keeps counting while speech is paused (`speechSynthesis.pause()`, or iOS pausing a background tab). On timeout the speech is cancelled before `speak()` rejects.

A `speak()` that is superseded by a newer `speak()` or ended by `stop()` now resolves, and a late `end` or `error` event from it is ignored. Previously, on Chrome, it could reject with `TTS Error: interrupted` or `TTS Error: canceled`.
