---
"@charivo/tts": patch
---

`stop()` cleanup now runs in `finally` so a player error no longer leaks audio/URL, and explicit `rate`/`pitch`/`volume` of `0` are honored via nullish checks.
