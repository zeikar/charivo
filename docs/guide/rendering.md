---
title: Rendering
sidebar_position: 5
---

# Rendering

Charivo's rendering layer is usually built from `@charivo/render` and
`@charivo/render-live2d`.

## Recommended Stack

Use:

- `@charivo/render-live2d` as the concrete renderer
- `@charivo/render` as the stateful manager

This is the default rendering path in the repo.

## What Each Package Does

- `@charivo/render-live2d` draws the Live2D model and exposes renderer methods
- `@charivo/render` connects the renderer to Charivo events, mouse tracking, canonical avatar actions, and lip-sync updates

Most apps use both together.

## Basic Setup

```ts
import { createLive2DRenderer } from "@charivo/render-live2d";
import { createRenderManager } from "@charivo/render";

const renderer = createLive2DRenderer({ canvas });
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel?.("/live2d/Hiyori/Hiyori.model3.json");
```

Attach the manager to `Charivo` after initialization:

```ts
charivo.attachRenderer(renderManager);
```

## What `@charivo/render` Adds

- character text rendering
- `tts:audio:start` and `tts:audio:end`
- `tts:lipsync:update`
- `avatar:expression`
- `avatar:motion`
- `avatar:gaze`
- optional mouse tracking

In normal app code, wire the manager to `Charivo` rather than handling these
events yourself.

**Expression auto-release:** expressions triggered via `avatar:expression` are
released automatically about 8 seconds after they are applied, and the model
fades back to its base face over the expression's `FadeOutTime` (1 second when
the `.exp3.json` does not set one) instead of snapping. Two qualifications:
parameters using the `Add` or `Multiply` blend fade smoothly when their
release duration is positive — an authored `FadeOutTime: 0` is honored as an
instant release, a knob model authors have — while parameters using
`Overwrite` snap to their base value, because the Cubism SDK rebases overwrite
values from the model every frame (uncommon in practice: none of the bundled
demo models use `Overwrite`). If the release is requested before the
expression has finished fading in — a long authored `FadeInTime`, or
rendering paused in a hidden tab — it waits for the fade-in to complete and
then fades, so an expression can remain visible beyond the nominal 8-second
hold. Idle motion, eye blink, and breath keep running throughout. This
applies when the renderer implements `stopExpression` —
`@charivo/render-live2d` does; a renderer that omits it keeps the expression
until something else replaces it.

## Event Wiring

`RenderManager` intentionally uses `setEventBus(...)`, not
`setEventEmitter(...)`.

Rendering subscribes to upstream events, so it needs the full event bus
contract. This split is part of the public design. Detaching or replacing the
renderer tears down its bus subscriptions and releases any held expression via
`disconnect()`, so a detached manager stops reacting to events without being
destroyed.

## Model Loading

The usual flow is:

1. create the canvas
2. create the renderer
3. create the render manager
4. call `initialize()`
5. call `loadModel(...)`
6. attach the manager to `Charivo`

If the renderer exposes optional methods such as `playExpression`,
`stopExpression`, `playMotionByGroup`, `lookAt`, or model catalog getters,
`@charivo/render` will use them automatically.

## Gaze Drivers

The render manager arbitrates between three gaze drivers:

1. **AI gaze** — driven by the `avatar:gaze` event from the realtime model's
   look intent. Owns the avatar's gaze while the AI suspend window is active.
2. **Local-presence gaze** — driven by calling `renderManager.setLocalGaze(coords)` from
   the app layer (e.g. webcam face tracking). Suspends mouse cursor tracking
   through a separate local-gaze window while active.
3. **Mouse cursor** — the default continuous mouse-tracking path.

**Priority for cursor-follow:** AI (`avatar:gaze`) > local-presence (`setLocalGaze`) > mouse cursor

**Deliberate taps** yield only to the AI window — local-presence does not
suppress them.

`setLocalGaze` returns `false` (no-op) while AI gaze owns the avatar or when
the renderer has no `lookAt`.

## Alternatives

- Use `@charivo/render/stub` for tests or demos that do not need real rendering.
- If you already have a custom renderer, keep using `@charivo/render` and provide a `Renderer` implementation from `@charivo/core`.

## References

- [Render Package README](https://github.com/zeikar/charivo/blob/main/packages/render/README.md)
- [render-live2d README](https://github.com/zeikar/charivo/blob/main/packages/render-live2d/README.md)
- [Examples Web](./examples-web.md)
