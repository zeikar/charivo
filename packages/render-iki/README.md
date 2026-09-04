# @charivo/render-iki

Iki-engine rendering adapter for Charivo. Implements the charivo `Renderer`
(plus the `MouseTrackable` pair) by driving an `.iki` puppet model through the
[Iki](https://github.com/zeikar/iki) engine — a from-scratch, open Live2D
alternative.

## Private dogfood adapter — not published

This package is **`private`** and is **not published to npm**. It exists to
dogfood the Iki engine against a real charivo integration.

It consumes [`@ikijs/engine`](https://www.npmjs.com/package/@ikijs/engine) and
[`@ikijs/format`](https://www.npmjs.com/package/@ikijs/format) as ordinary npm
dependencies — no sibling checkout, no path aliases, and the engine stays
external in the bundle rather than being inlined into `dist`.

Being private does not keep it out of the root passes: it has plain
`build` / `typecheck` / `dev` scripts like every other package, so `pnpm verify`
and CI compile it against the published engine. That is the point — a breaking
change in Iki should fail charivo's build, not surface later by hand.

It resolves `@charivo/core` and `@charivo/render` via their **built** `dist`
declarations (not source), so both must be built first — which the root
`pnpm build` already does in workspace-dependency order.

```bash
pnpm install
pnpm build            # @charivo/core → @charivo/render → this adapter
```

## Usage

Swap `createLive2DRenderer` for `createIkiRenderer` — the rest of the charivo
wiring is unchanged:

```ts
import { createIkiRenderer } from "@charivo/render-iki";
import { createRenderManager } from "@charivo/render";

const renderer = createIkiRenderer({ canvas });
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel?.("/iki/hiyori.iki.json");
```

(The package-name import resolves to `dist/`, so run
`pnpm --filter @charivo/render-iki build` first.)

## Try it

A runnable local harness lives in [`examples/iki-test`](../../examples/iki-test) —
it drives a sample `.iki` model through charivo's `RenderManager` + this adapter
(idle breath/blink, mouse-follow gaze, simulated lip-sync). Run
`pnpm --filter @charivo/iki-test dev` and open the Vite URL.

## Public surface

- `initialize()` — create the WebGL player (requires a canvas).
- `loadModel(modelPath)` — fetch + parse an `.iki` model, start rendering, and
  begin the idle loop (breath + blink).
- `render(message, character?)` — stateless (the engine's RAF draws).
- `destroy()` — stop the idle loop and free the player.
- `setRealtimeLipSync(enabled)` / `updateRealtimeLipSyncRms(rms)` — drive the
  mouth aperture (`ParamMouthOpenY`) from lip-sync RMS.
- `lookAt({ x, y })` — gaze (each `-1..1`, `y=1` up) → head angle + eyeballs.
- `updateViewWithMouse` / `handleMouseTap` — the `MouseTrackable` pair for
  cursor-follow. Both are present because `RenderManager` installs mouse
  tracking only when both exist; tap is a no-op today (Iki has no tap motions).

**Not supported yet:** expressions and motions. Iki has no expression/motion
concept, so this adapter omits `playExpression` / `playMotionByGroup` /
`getAvailableExpressions` / `getAvailableMotionGroups`, and `RenderManager`
feature-detects their absence and skips them.
