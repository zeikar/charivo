---
"@charivo/render-live2d": patch
---

Fix realtime lip sync being overpowered by expressions that move the mouth.

An expression re-applies its parameter values every frame, so one that pins a
mouth parameter fights lip sync for the same parameter — Haru's "big laugh"
holds `ParamMouthOpenY`, which is also its lip-sync parameter. The realtime
override that exists to win that fight only ran while the analyzed level was
above zero, so every gap between syllables let the expression snap the mouth
back open. The mouth ended up moving opposite to the voice, reading as lip sync
simply not working whenever such an expression was active.

The override now runs for the whole utterance, including at zero level, so
silence drives the mouth closed instead of surrendering it to the expression.
Outside an utterance realtime lip sync is off, so expressions keep full control
of the mouth as before. The WAV-driven path used by motion files is unchanged
and still blends additively.
