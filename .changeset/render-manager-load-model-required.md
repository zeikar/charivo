---
"@charivo/core": minor
"@charivo/render-live2d": minor
"@charivo/render-iki": minor
---

`loadModel` is a required member of `RenderManager`, `Live2DRenderer` and `IkiRenderer`, so `renderManager.loadModel(path)` and `renderer.loadModel(path)` no longer need `?.`. Nothing changes at runtime: the manager from `createRenderManager` and both renderers always had the method, and the manager still resolves without loading anything when its renderer has no `loadModel`. Existing `loadModel?.(...)` calls keep compiling, and `Renderer.loadModel` stays optional for a renderer of your own.

What breaks is code that produces one of the three types itself: a hand-written `RenderManager`, or a class or test double typed as `Live2DRenderer` or `IkiRenderer`, must now declare `loadModel`. Upgrade the `@charivo/*` packages together: an older `@charivo/render` beside this `@charivo/core` keeps its own copy of the core types, and the manager it returns no longer type-checks against `attachRenderer`.
