---
"@charivo/tts": patch
---

`stop()` cleanup now runs in `finally` so a player error no longer leaks audio/URL; explicit `pitch`/`volume` of `0` are now honored via nullish checks (plus `rate: 0` on the Web Speech path, where it clamps to the valid minimum).
