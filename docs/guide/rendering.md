---
title: Rendering
sidebar_position: 5
---

# Rendering

Charivo's rendering layer is built from `@charivo/render` and a concrete
renderer: `@charivo/render-live2d` for Live2D Cubism models, or
`@charivo/render-iki` for `.iki` models.

## Recommended Stack

Use:

- `@charivo/render-live2d` or `@charivo/render-iki` as the concrete renderer
- `@charivo/render` as the stateful manager

The examples on this page use Live2D, the default path in the repo. The Iki
renderer takes the same wiring; see [Iki Renderer](#iki-renderer).

## What Each Package Does

- `@charivo/render-live2d` draws a Live2D model and exposes renderer methods
- `@charivo/render-iki` does the same for an `.iki` model on the open
  [Iki](https://github.com/zeikar/iki) engine
- `@charivo/render` connects the renderer to Charivo events, mouse tracking, canonical avatar actions, and lip-sync updates

Most apps use the manager with one of the two renderers.

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
await renderManager.loadModel("/live2d/Hiyori/Hiyori.model3.json");
```

Attach the manager to `Charivo` after initialization:

```ts
charivo.attachRenderer(renderManager);
```

## Iki Renderer

`@charivo/render-iki` draws an `.iki` model on the
[Iki](https://github.com/zeikar/iki) engine. The setup is the one above with
`createIkiRenderer` in place of `createLive2DRenderer`:

```bash
pnpm add @charivo/render-iki @charivo/render
```

```ts
import { createIkiRenderer } from "@charivo/render-iki";
import { createRenderManager } from "@charivo/render";

const renderer = createIkiRenderer({ canvas });
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel("/iki/hero.iki");
```

The rest of this page applies to both renderers: the manager, its events,
lip-sync, expressions, motions and gaze. What differs with Iki:

- **License.** The package and the engine are MIT, and no Live2D SDK is in the
  bundle.
- **Model file.** An `.iki` model is one JSON file with its textures inside.
  The two the web demo uses are in
  [`examples/web/public/iki/`](https://github.com/zeikar/charivo/tree/main/examples/web/public/iki).
- **Catalog.** The file declares a description for every expression and motion,
  and `renderer.getAvatarControlCatalog()` returns them with the ids and
  counts, so avatar tools need no hand-written descriptions; see
  [Building The Catalog](./avatar.md#building-the-catalog).
- **Framing.** `renderer.setView({ x, y, width, height })` frames that region
  (centre and size in model units, `y` up) instead of the model's own box,
  for example a full body whose raised arm leaves the box.
- **Taps and motion audio.** Iki has no tap motions and its clips carry no
  audio, so a tap does nothing and `muteSound` has nothing to mute.

An app that offers both kinds of character gives each engine its own canvas:
a canvas keeps the WebGL context its first renderer created, with that
renderer's context attributes. The
[web demo](./examples-web.md) does this, and opens on an Iki character with
[`?character=twin`](https://charivo.vercel.app/?character=twin) or
[`?character=mint`](https://charivo.vercel.app/?character=mint).

## What `@charivo/render` Adds

- character text rendering
- `tts:audio:start` and `tts:audio:end`
- `tts:lipsync:update`
- `avatar:expression`
- `avatar:motion` — may carry `muteSound`, which plays the motion without its
  baked-in sample clip. `@charivo/avatar` sets it on tool-call motions so a
  Cubism sample's prerecorded voice never talks over the character's own;
  without the flag the clip stays audible.
- `avatar:gaze`
- optional mouse tracking

In normal app code, wire the manager to `Charivo` rather than handling these
events yourself.

## Expression Auto-Release

An expression triggered via `avatar:expression` is released when
`tts:audio:end` arrives — however long the utterance runs — and the model fades
back to its base face over the expression's `FadeOutTime` (1 second when the
`.exp3.json` does not set one) instead of snapping.

A roughly 8-second timer is the fallback for setups where no audio events flow
at all, such as text-only configurations that never emit `tts:audio:start` /
`tts:audio:end`. It is disarmed while an utterance is playing, so it never
competes with speech: it fires only before speech starts, or where it is the
sole release trigger.

Three qualifications:

- Parameters using the `Add` or `Multiply` blend fade smoothly when their
  release duration is positive — an authored `FadeOutTime: 0` is honored as an
  instant release, a knob model authors have. Parameters using `Overwrite` snap
  to their base value instead, because the Cubism SDK rebases overwrite values
  from the model every frame (uncommon in practice: none of the bundled demo
  models use `Overwrite`).
- A release requested before the expression has finished fading in — a long
  authored `FadeInTime`, or rendering paused in a hidden tab — waits for the
  fade-in to complete and then fades, so an expression can remain visible
  beyond the nominal 8-second hold.
- This applies when the renderer implements `stopExpression`.
  `@charivo/render-live2d` does, and so does `@charivo/render-iki`, which fades
  over the `.iki` expression's own `fadeOut`; a renderer that omits it keeps
  the expression until something else replaces it.

Idle motion, eye blink, and breath keep running throughout.

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

Calling `loadModel(...)` again switches models. If a second call starts before
the first has finished, the latest call wins in both renderers in this repo
(`@charivo/render-live2d` and `@charivo/render-iki`): the
earlier load is dropped however late it lands. A renderer of your own should do
the same, since an app switching characters does not wait for the previous
switch.

If the renderer exposes optional methods such as `playExpression`,
`stopExpression`, `playMotionByGroup`, `lookAt`, or model catalog getters,
`@charivo/render` will use them automatically. `getAvatarControlCatalog` is
for the app, not the manager: it is where avatar tools read the catalog from
— see [Building The Catalog](./avatar.md#building-the-catalog).

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

### Where The Cursor Is Measured From

By default the cursor-follow gaze is measured from the canvas's centre. That
suits a bust, whose face is near it. On a full-body model the centre is the
waist, so a pointer on the face counts as above it and the character looks up.

`renderer.setGazeOrigin({ x, y })` names the point to measure from instead,
usually the one between the eyes. It is a `GazeOrigin` from `@charivo/render`:
fractions of the model's own canvas, `(0, 0)` its top-left corner and `(1, 1)`
its bottom-right, the way the point reads off a picture of the model. Both
renderers in this repo (`@charivo/render-live2d` and `@charivo/render-iki`)
implement it with those same units, and each
places the point on the canvas itself, so it holds at any canvas size or
framing.

```ts
await renderManager.loadModel("/live2d/Haru/Haru.model3.json");
renderer.setGazeOrigin({ x: 0.5, y: 0.14 });
```

- Call it on the renderer, not the manager, and again when the next model's
  face is elsewhere: the renderer holds it across `loadModel`.
- No argument restores the canvas's centre. A non-finite `x` or `y` throws.
- Only the mouse cursor is affected. Taps hit-test where the pointer is, and
  `lookAt` / `setLocalGaze` / AI gaze already take a direction.
- It is an optional member of `MouseTrackable`, so a renderer of your own may
  leave it out; an app that supports several renderers calls
  `renderer.setGazeOrigin?.(origin)`.

## Alternatives

- Use `@charivo/render/stub` for tests or demos that do not need real rendering.
- If you already have a custom renderer, keep using `@charivo/render` and provide a `Renderer` implementation from `@charivo/core`.

## References

- [Render Package README](https://github.com/zeikar/charivo/blob/main/packages/render/README.md)
- [render-live2d README](https://github.com/zeikar/charivo/blob/main/packages/render-live2d/README.md)
- [render-iki README](https://github.com/zeikar/charivo/blob/main/packages/render-iki/README.md)
- [Examples Web](./examples-web.md)
