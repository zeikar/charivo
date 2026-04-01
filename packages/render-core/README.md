# @charivo/render-core

Stateful render manager and rendering utilities for Charivo.

Use this package when you already have a renderer implementation, such as
`@charivo/render-live2d`, and want the manager that bridges TTS, realtime
emotion events, mouse tracking, and message rendering.

## Install

```bash
pnpm add @charivo/render-core
```

## Usage

```ts
import { createRenderManager } from "@charivo/render-core";
import { createLive2DRenderer } from "@charivo/render-live2d";

const renderer = createLive2DRenderer({ canvas });
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel?.("/live2d/hiyori/hiyori.model3.json");
```

## What It Does

- wraps a `Renderer` implementation
- subscribes to the typed `CharivoEventBus`
- reacts to `tts:audio:start`, `tts:audio:end`, and `tts:lipsync:update`
- reacts to `realtime:emotion`
- applies character emotion mappings to expressions and motions
- optionally wires mouse tracking to a canvas or the full document

## Exports

- `RenderManager`
- `createRenderManager(renderer, options?)`
- `RealTimeLipSync`
- `setupMouseTracking(...)`

## Renderer Expectations

At minimum, a renderer must implement the `Renderer` contract from `@charivo/core`.
If it also exposes optional methods such as `loadModel`, `setRealtimeLipSync`,
`updateRealtimeLipSyncRms`, `playExpression`, or `playMotionByGroup`, the render
manager will use them automatically.
