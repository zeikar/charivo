---
"@charivo/realtime": patch
---

Strip trailing punctuation from a character's `personality` in linear time. The previous regex was quadratic on long runs of `.`, `!` or `?`.
