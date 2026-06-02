# @charivo/render

Stateful render manager and rendering utilities for Charivo.

Use this package when you already have a renderer implementation, such as
`@charivo/render-live2d`, and want the manager that bridges TTS, realtime
avatar action events, mouse tracking, and message rendering.

## Install

```bash
pnpm add @charivo/render
```

## Usage

```ts
import { createRenderManager } from "@charivo/render";
import { createLive2DRenderer } from "@charivo/render-live2d";

const renderer = createLive2DRenderer({ canvas });
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel?.("/live2d/hiyori/hiyori.model3.json");
```

For iOS-safe realtime lipsync, prepare audio from the same user gesture that
starts your voice session:

```ts
await renderManager.prepareAudio?.();
```

## What It Does

- wraps a `Renderer` implementation
- consumes the typed `CharivoEventBus`
- reacts to `tts:audio:start`, `tts:audio:end`, and `tts:lipsync:update`
- reacts to `realtime:expression`, `realtime:motion`, and `realtime:gaze`
- optionally wires mouse tracking to a canvas or the full document
- exposes `prepareAudio()` for pre-warming lipsync audio contexts on mobile

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

This manager consumes the full bus because it needs subscription access, not
just event emission. `RenderManager` also exposes `disconnect()` to remove the
listeners registered by `setEventBus`; `destroy()` calls it automatically.
