# @charivo/render-iki

Iki-engine rendering adapter for Charivo. Implements the charivo `Renderer`
(plus the `MouseTrackable` pair) by driving an `.iki` puppet model through the
[Iki](https://github.com/zeikar/iki) engine — a from-scratch, open Live2D
alternative.

## Local dogfood — not published, not in CI

This package is **`private`** and is **not published to npm**. It consumes the
**unpublished** sibling packages `@iki/engine` and `@iki/format` via TypeScript
`paths` and a tsup esbuild `alias` pointing at the sibling's **built** output —
the Iki bundle is inlined into this package's `dist`, so the build output is
self-contained.

**Prerequisite — clone and build Iki next to charivo.** The adapter resolves
the engine at `../iki` relative to the charivo repo root (i.e. `iki` and
`charivo` share a parent directory):

```
<parent>/
├── charivo/
└── iki/
```

This package also resolves `@charivo/core` and `@charivo/render` via their
**built** `dist` declarations (not source). Both must be built before
`build:local` can succeed.

```bash
# 1. in the iki repo, build the engine + format packages
pnpm install
pnpm build            # or: pnpm --filter @iki/engine build && pnpm --filter @iki/format build

# 2. in the charivo repo, build the workspace deps that this adapter consumes
#    (run from the charivo repo root)
pnpm build            # or: pnpm --filter @charivo/core build && pnpm --filter @charivo/render build

# 3. then build this adapter
pnpm --filter @charivo/render-iki build:local
```

This package's scripts are intentionally named **`build:local`**,
**`typecheck:local`**, and **`dev:local`** (NOT `build`/`typecheck`/`dev`). The
root `pnpm verify` / `pnpm dev` aggregators run `pnpm -r` over packages that
have a `build`/`typecheck`/`dev` script, so the `:local` naming keeps this
package out of those root passes — that is what lets `pnpm verify` and
`pnpm dev` succeed when the `../iki` sibling is absent (e.g. in CI). **Do not
rename these scripts** to the plain forms, or the root aggregators will try to
build this package and fail without the sibling present.

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

(The package-name import resolves to `dist/` only after
`pnpm --filter @charivo/render-iki build:local` has run with the sibling built.)

## Try it

A runnable local harness lives in [`examples/iki-test`](../../examples/iki-test) —
it drives a sample `.iki` model through charivo's `RenderManager` + this adapter
(idle breath/blink, mouse-follow gaze, simulated lip-sync). With the `../iki`
sibling present, run `pnpm --filter @charivo/iki-test dev` and open the Vite URL.

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
