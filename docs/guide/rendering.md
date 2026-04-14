# Rendering

This guide answers one question: how should you wire Live2D rendering in a
Charivo app?

Use it when you want a visible character on screen and need to understand the
split between `render-core` and `render-live2d`.

## Recommended Default

Use:

- `@charivo/render-live2d` as the concrete renderer
- `@charivo/render-core` as the stateful manager

That is the default renderer path used throughout the repo.

## What Each Package Does

- `@charivo/render-live2d` draws the Live2D model and exposes renderer methods
- `@charivo/render-core` bridges that renderer to Charivo events, mouse tracking, emotion mappings, and lip-sync updates

In practice, most apps use both together.

## Basic Wiring

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

Attach the render manager to `Charivo` after initialization:

```ts
charivo.attachRenderer(renderManager);
```

## What `render-core` Handles For You

- character text rendering
- `tts:audio:start` and `tts:audio:end`
- `tts:lipsync:update`
- `realtime:emotion`
- emotion-to-expression and emotion-to-motion mapping
- optional mouse tracking

That means you should normally connect the manager to the `Charivo` instance,
not wire these events manually.

## Event Contract

`RenderManager` intentionally uses `setEventBus(...)`, not
`setEventEmitter(...)`.

That is because rendering subscribes to upstream events and needs the full bus
contract. This split is intentional and should be preserved when extending the
system.

## Model Loading

The common flow is:

1. create the canvas
2. create the renderer
3. create the render manager
4. call `initialize()`
5. call `loadModel(...)`
6. attach the manager to `Charivo`

If your renderer exposes optional methods such as `playExpression` or
`playMotionByGroup`, `render-core` can use them automatically.

## When To Use Something Else

- Use `@charivo/render-stub` for tests or demos that do not need real rendering.
- If you already have a custom renderer implementation, keep using `render-core` and provide a `Renderer` contract implementation from `@charivo/core`.

## References

- [render-core README](../../packages/render-core/README.md)
- [render-live2d README](../../packages/render-live2d/README.md)
- [Examples Web](./examples-web.md)

## Next Steps

- [Getting Started](./getting-started.md)
- [Architecture](./architecture.md)
- [Examples Web](./examples-web.md)
