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

- `createRenderManager(renderer, options?)`
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

- It does not open the AI gaze suspend window used by `realtime:gaze`.
- It does not suppress deliberate taps — tap-driven gaze yields only to the AI
  window, not to the local-gaze window.

**Returns `false` (no-op) when:**

- AI gaze currently owns the avatar (the `realtime:gaze` suspend window is
  active), or
- the renderer has no `lookAt` method.

**Gaze driver priority:**

- Cursor-follow: AI (`realtime:gaze`) > local-presence (`setLocalGaze`) > mouse cursor
- Deliberate taps: AI (`realtime:gaze`) > tap (local-presence does not suppress taps)
