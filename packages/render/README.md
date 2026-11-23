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
await renderManager.loadModel("/live2d/hiyori/hiyori.model3.json");
```

## What It Does

- wraps a `Renderer` implementation
- consumes the typed `CharivoEventBus`
- toggles the renderer's `setRealtimeLipSync` on `tts:audio:start` /
  `tts:audio:end` and feeds `updateRealtimeLipSyncRms` from the RMS numbers
  carried by `tts:lipsync:update` — it does not analyze audio itself; the TTS
  and realtime managers produce those numbers; `tts:audio:end` also ends the
  audio-based speech span described below
- reacts to `avatar:expression`, `avatar:motion`, `avatar:gaze` and
  `avatar:release`; an `avatar:motion` carrying `muteSound` has that flag
  forwarded to the renderer, and one without it stays audible
- shows expressions and gaze through claims: each `avatar:expression` or
  `avatar:gaze` is a claim on its channel with an optional `source`,
  `priority` (`reflex` > `explicit` > `inferred` > `ambient`) and `hold`, and
  the highest live claim is shown, a tie going to the newest. A claim with no
  `hold` gets the channel default: an expression lasts for the speech it
  accompanies, a gaze 1,200 ms. `avatar:release` ends a source's claims early
- releases an expression through `stopExpression` when its last claim ends, if
  the renderer supports it: speech-scoped claims end with their speech span (a
  voiced `performance:start` to `performance:end`, or else `tts:audio:start` to
  `tts:audio:end`), and a roughly 8-second window covers setups where no speech
  starts (text-only). Only the claims bound to a span end with it, so a silent
  reaction with its own hold outlives unrelated speech. With
  `@charivo/render-live2d` the release fades `Add` and `Multiply`
  parameters back to the base face when their release duration (the
  expression's `FadeOutTime`) is positive (`Overwrite` parameters snap — an
  SDK constraint). The release also waits until the expression has
  finished fading in, so it can remain visible beyond the nominal 8-second
  window
- forwards a motion's priority to the renderer (`reflex` as `"force"`,
  `ambient` as `"idle"`, otherwise nothing) and lets the renderer decide
  against the clip actually running
- optionally wires mouse tracking to a canvas or the full document

## Exports

- `createRenderManager(renderer, options?)`
- `setupMouseTracking(...)`

## Renderer Expectations

At minimum, a renderer must implement the `Renderer` contract from `@charivo/core`.
If it also exposes optional methods such as `loadModel`, `setRealtimeLipSync`,
`updateRealtimeLipSyncRms`, `playExpression`, `stopExpression`,
`playMotionByGroup`, `lookAt`, `clearGaze`, `getAvailableExpressions`, or
`getAvailableMotionGroups`, the render manager will use them automatically.
`clearGaze` is called when the last gaze claim ends, to drop the target a
`lookAt` set.
`getAvatarControlCatalog` is the exception: the manager never calls it — it
hands the app the model's catalog for avatar tools.

Mouse tracking is installed when the renderer is `MouseTrackable`
(`updateViewWithMouse` and `handleMouseTap`). That contract also has an
optional `setGazeOrigin(origin?)`, which the app calls on the renderer itself:
the point of the model, as a `GazeOrigin` (fractions of the model's own canvas,
top-left `(0, 0)` to bottom-right `(1, 1)`), that the cursor is measured from
instead of the canvas's centre — between the eyes of a full body, so a pointer
on the face looks straight ahead. See
[Where The Cursor Is Measured From](../../docs/guide/rendering.md#where-the-cursor-is-measured-from).

## Event Wiring

`RenderManager` uses `setEventBus(...)` because it subscribes to upstream
Charivo events. In the default flow it listens for:

- `tts:audio:start`
- `tts:audio:end`
- `tts:lipsync:update`
- `avatar:expression`
- `avatar:motion`
- `avatar:gaze`
- `avatar:release`
- `performance:start`
- `performance:end`

This manager consumes the full bus because it needs subscription access, not
just event emission. `RenderManager` also exposes `disconnect()` to remove the
listeners registered by `setEventBus` and release every claim and any held
expression;
`destroy()` calls it automatically.

## Local-Presence Gaze

`RenderManager` exposes a public method for driving gaze from a local-presence
source such as webcam face tracking:

```ts
renderManager.setLocalGaze({ x: 0.3, y: -0.1 }); // returns boolean
```

**What it does:**

- Calls the renderer's `lookAt` with the supplied coordinates.
- Briefly suspends mouse cursor tracking (the `updateViewWithMouse` path) via a
  separate local-gaze window, so the webcam/local-presence driver beats the
  cursor while the window is active.

**What it does NOT do:**

- It does not make a gaze claim, so it never holds the avatar's gaze, and its
  target persists until something else replaces it.
- It does not suppress deliberate taps — tap-driven gaze yields only to a live
  gaze claim, not to the local-gaze window.

**Returns `false` (no-op) when:**

- a gaze claim is live (an `avatar:gaze` is still held), or
- the renderer has no `lookAt` method.

**Gaze driver priority:**

- Cursor-follow: gaze claim (`avatar:gaze`) > local-presence (`setLocalGaze`) > mouse cursor
- Deliberate taps: gaze claim (`avatar:gaze`) > tap (local-presence does not suppress taps)

When the last gaze claim ends, the manager calls the renderer's `clearGaze()`
if it has one, so the renderer's own resting gaze resumes.
