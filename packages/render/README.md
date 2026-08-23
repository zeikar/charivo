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

## What It Does

- wraps a `Renderer` implementation
- consumes the typed `CharivoEventBus`
- toggles the renderer's `setRealtimeLipSync` on `tts:audio:start` /
  `tts:audio:end` and feeds `updateRealtimeLipSyncRms` from the RMS numbers
  carried by `tts:lipsync:update` — it does not analyze audio itself; the TTS
  and realtime managers produce those numbers; `tts:audio:end` also triggers
  the expression release described below
- reacts to `avatar:expression`, `avatar:motion`, and `avatar:gaze`; an
  `avatar:motion` carrying `muteSound` has that flag forwarded to the renderer,
  and one without it stays audible
- automatically releases an applied expression via `stopExpression` when
  `tts:audio:end` arrives, however long the utterance runs, if the renderer
  supports it; a roughly 8-second timer covers only configs where no audio
  events flow at all (text-only setups) and stands down while speech is
  playing — with
  `@charivo/render-live2d` the release fades `Add` and `Multiply`
  parameters back to the base face when their release duration (the
  expression's `FadeOutTime`) is positive (`Overwrite` parameters snap — an
  SDK constraint). The release also waits until the expression has
  finished fading in, so it can remain visible beyond the nominal 8-second
  hold. That timer is disarmed while an utterance is playing, so it only
  fires before speech starts or in setups that never emit audio events
  (e.g. text-only LLM configurations), where it is the sole release
  trigger
- optionally wires mouse tracking to a canvas or the full document

## Exports

- `createRenderManager(renderer, options?)`
- `setupMouseTracking(...)`

## Renderer Expectations

At minimum, a renderer must implement the `Renderer` contract from `@charivo/core`.
If it also exposes optional methods such as `loadModel`, `setRealtimeLipSync`,
`updateRealtimeLipSyncRms`, `playExpression`, `stopExpression`,
`playMotionByGroup`, `lookAt`, `getAvailableExpressions`, or
`getAvailableMotionGroups`, the render manager will use them automatically.

## Event Wiring

`RenderManager` uses `setEventBus(...)` because it subscribes to upstream
Charivo events. In the default flow it listens for:

- `tts:audio:start`
- `tts:audio:end`
- `tts:lipsync:update`
- `avatar:expression`
- `avatar:motion`
- `avatar:gaze`

This manager consumes the full bus because it needs subscription access, not
just event emission. `RenderManager` also exposes `disconnect()` to remove the
listeners registered by `setEventBus` and release any held expression;
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

- It does not open the AI gaze suspend window used by `avatar:gaze`.
- It does not suppress deliberate taps — tap-driven gaze yields only to the AI
  window, not to the local-gaze window.

**Returns `false` (no-op) when:**

- AI gaze currently owns the avatar (the `avatar:gaze` suspend window is
  active), or
- the renderer has no `lookAt` method.

**Gaze driver priority:**

- Cursor-follow: AI (`avatar:gaze`) > local-presence (`setLocalGaze`) > mouse cursor
- Deliberate taps: AI (`avatar:gaze`) > tap (local-presence does not suppress taps)
