---
"@charivo/core": patch
---

`EventBus.emit()` now iterates a snapshot of the listener list.

It used to iterate the live array, so a listener that called `off()` during
dispatch spliced the array and shifted the next listener out of that emit.
`RenderManager.disconnect()` removes six listeners at once and runs on the
`attachRenderer()` replacement path, which is exactly this shape. Listeners
removed mid-emit still fire for that emit; the removal applies from the next
one.
