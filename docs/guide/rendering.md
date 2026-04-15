---
title: Rendering
sidebar_position: 5
---

# Rendering

Charivo's rendering layer is usually built from `@charivo/render-core` and
`@charivo/render-live2d`.

## Recommended Stack

Use:

- `@charivo/render-live2d` as the concrete renderer
- `@charivo/render-core` as the stateful manager

This is the default rendering path in the repo.

## What Each Package Does

- `@charivo/render-live2d` draws the Live2D model and exposes renderer methods
- `@charivo/render-core` connects the renderer to Charivo events, mouse tracking, emotion mappings, and lip-sync updates

Most apps use both together.

## Basic Setup

```ts
import { createLive2DRenderer } from "@charivo/render-live2d";
import { createRenderManager } from "@charivo/render-core";

const renderer = createLive2DRenderer({ canvas });
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel("/live2d/Hiyori/Hiyori.model3.json");
```

Attach the manager to `Charivo` after initialization:

```ts
charivo.attachRenderer(renderManager);
```

## What `render-core` Adds

- character text rendering
- `tts:audio:start` and `tts:audio:end`
- `tts:lipsync:update`
- `realtime:emotion`
- emotion-to-expression and emotion-to-motion mapping
- optional mouse tracking

In normal app code, wire the manager to `Charivo` rather than handling these
events yourself.

## Event Wiring

`RenderManager` intentionally uses `setEventBus(...)`, not
`setEventEmitter(...)`.

Rendering subscribes to upstream events, so it needs the full event bus
contract. This split is part of the public design.

## Model Loading

The usual flow is:

1. create the canvas
2. create the renderer
3. create the render manager
4. call `initialize()`
5. call `loadModel(...)`
6. attach the manager to `Charivo`

If the renderer exposes optional methods such as `playExpression` or
`playMotionByGroup`, `render-core` will use them automatically.

## Alternatives

- Use `@charivo/render-stub` for tests or demos that do not need real rendering.
- If you already have a custom renderer, keep using `render-core` and provide a `Renderer` implementation from `@charivo/core`.

## References

- [render-core README](https://github.com/zeikar/charivo/blob/main/packages/render-core/README.md)
- [render-live2d README](https://github.com/zeikar/charivo/blob/main/packages/render-live2d/README.md)
- [Examples Web](./examples-web.md)
