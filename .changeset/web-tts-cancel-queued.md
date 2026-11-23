---
"@charivo/tts": patch
---

`@charivo/tts/web`: `stop()` now also cancels an utterance the browser is still holding before it starts speaking (for example while Firefox loads voices). Previously it cancelled only while `speechSynthesis.speaking` was true, so a queued line could play after a stop.
