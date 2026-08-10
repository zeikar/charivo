---
"@charivo/render": minor
---

Expressions set via `avatar:expression` now also release when `tts:audio:end`
arrives, in addition to the existing ~8-second hold — whichever happens
first. The hold is still armed for every accepted expression on renderers
that implement `stopExpression`; a renderer without it remains a silent
no-op, unchanged. The hold ceiling runs independently of `tts:audio:end`, so
it still fires mid-speech for utterances that outlast it, and it remains the
only release trigger for setups that never emit audio events (e.g. text-only
LLM configurations). The release fade mechanics — fading over the
expression's `FadeOutTime`, waiting for a pending fade-in to finish first,
and `Overwrite` parameters snapping — are unchanged.
