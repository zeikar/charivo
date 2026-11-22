---
"@charivo/render": patch
---

`createRenderManager()` returns a manager whose `loadModel`, `setLocalGaze` and `setMessageCallback` are required in the type, following `RenderManager` in `@charivo/core`: calling them needs no `?.`. The methods were always there and behave as before. Upgrade together with `@charivo/core`.
