---
"@charivo/core": minor
"@charivo/render-live2d": minor
"@charivo/render-iki": minor
---

Members that were always present are now required in the types, so calling them needs no `?.`: `loadModel`, `setLocalGaze` and `setMessageCallback` on `RenderManager`, and `loadModel` on `Live2DRenderer` and `IkiRenderer`. Nothing changes at runtime: the manager from `createRenderManager` and both renderers always had these methods, and the manager still resolves `loadModel` without loading anything when its renderer has none. Existing `?.` calls keep compiling, and `Renderer.loadModel` stays optional for a renderer of your own.

What breaks is code that produces one of the three types itself: a hand-written `RenderManager` must now declare `loadModel`, `setLocalGaze` and `setMessageCallback`, and a class or test double typed as `Live2DRenderer` or `IkiRenderer` must declare `loadModel`. Upgrade the `@charivo/*` packages together: an older `@charivo/render` beside this `@charivo/core` keeps its own copy of the core types, and the manager it returns no longer type-checks against `createCharivo({ renderer })` or `attachRenderer`.
