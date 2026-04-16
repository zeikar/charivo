# @charivo/render-core

Stateful render manager and rendering utilities for Charivo.

Use this package when you already have a renderer implementation, such as
`@charivo/render-live2d`, and want the manager that bridges TTS, realtime
avatar action events, mouse tracking, and message rendering.

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
- consumes the typed `CharivoEventBus`
- reacts to `tts:audio:start`, `tts:audio:end`, and `tts:lipsync:update`
- reacts to `realtime:expression`, `realtime:motion`, and `realtime:gaze`
- still accepts `realtime:emotion` as a deprecated compatibility input
- translates `emotionMappings` into expression/motion presets when needed
- optionally wires mouse tracking to a canvas or the full document

## Exports

- `RenderManager`
- `createRenderManager(renderer, options?)`
- `RealTimeLipSync`
- `setupMouseTracking(...)`

## Renderer Expectations

At minimum, a renderer must implement the `Renderer` contract from `@charivo/core`.
If it also exposes optional methods such as `loadModel`, `setRealtimeLipSync`,
`updateRealtimeLipSyncRms`, `playExpression`, `playMotionByGroup`, `lookAt`,
`getAvailableExpressions`, or `getAvailableMotionGroups`, the render manager
will use them automatically.

## Event Wiring

`RenderManager` uses `setEventBus(...)` because it subscribes to upstream
Charivo events. In the default flow it listens for:

- `tts:audio:start`
- `tts:audio:end`
- `tts:lipsync:update`
- `realtime:expression`
- `realtime:motion`
- `realtime:gaze`
- `realtime:emotion` (deprecated compatibility event)

This manager consumes the full bus because it needs subscription access, not
just event emission.
