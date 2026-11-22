---
"@charivo/render-iki": minor
---

First release on npm. `@charivo/render-iki` draws an `.iki` model on the open [Iki](https://github.com/zeikar/iki) engine through the same `Renderer` and `MouseTrackable` contracts as `@charivo/render-live2d`, so `createIkiRenderer({ canvas })` takes the place of `createLive2DRenderer` under `@charivo/render` with lip-sync, expressions, motions, gaze and the avatar control catalog. The package exports the `createIkiRenderer` factory and the `IkiRenderer`, `IkiRendererOptions` and `IkiView` types; it is browser-only, ESM-only and MIT.
