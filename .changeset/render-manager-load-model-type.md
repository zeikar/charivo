---
"@charivo/render": patch
---

`createRenderManager()` returns a manager whose `loadModel` is required in the type, following `RenderManager` in `@charivo/core`: `renderManager.loadModel(path)` needs no `?.`. The method was always there and behaves as before. Upgrade together with `@charivo/core`.
