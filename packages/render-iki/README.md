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
await renderManager.loadModel?.("/hero.iki");
```

(The package-name import resolves to `dist/`, so run
`pnpm --filter @charivo/render-iki build` first.)

## Try it

A runnable local harness lives in [`examples/iki-test`](../../examples/iki-test) —
it drives the Iki hero model through charivo's `RenderManager` + this adapter
(engine idle + hair physics, mouse-follow gaze blended over the sway, simulated
lip-sync). Run `pnpm --filter @charivo/iki-test dev` and
open the Vite URL.

## Public surface

- `initialize()` — create the WebGL player (requires a canvas).
- `loadModel(modelPath)` — fetch + parse an `.iki` model, start rendering,
  build the engine's `IkiMotion` for it and start the adapter's rAF loop that
  steps it (the engine's own render loop draws).
- `render(message, character?)` — stateless (the engine's RAF draws).
- `destroy()` — stop that loop and free the player.
- `setRealtimeLipSync(enabled)` / `updateRealtimeLipSyncRms(rms)` — drive the
  mouth aperture (`ParamMouthOpenY`) from lip-sync RMS.
- `lookAt({ x, y })` — sets the gaze target; see "Motion" for how it meets the
  idle drivers.
- `updateViewWithMouse` / `handleMouseTap` — the `MouseTrackable` pair for
  cursor-follow. Both are present because `RenderManager` installs mouse
  tracking only when both exist; tap is a no-op today (Iki has no tap motions).

## Motion

Idle animation, hair-spring physics and chain secondary-motion are not this
adapter's code — they come from `@ikijs/engine`'s `IkiMotion`, built fresh in
`loadModel()` for the loaded model's rigs. The adapter only schedules it (one
`update(now)` per rAF tick) and blends the host's gaze on top before writing
the player, in `src/motion-blend.ts`.

The blend is a fixed precedence table, keyed by parameter:

| Parameter | Policy |
| --- | --- |
| `ParamAngleX`, `ParamAngleY` | host target (`HEAD_ANGLE_RANGE_DEG = 26` × gaze) **+** idle sway. 26° (not the store's full ±30°) leaves headroom so a parked, off-canvas pointer — the normal state under `mouseTracking: "document"` — still shows the full idle sway instead of rectifying into a one-sided twitch. |
| `ParamAngleZ` | pass through — no lean into the turn from the host (nor from the auto-rig any more): a roll riding on the turn swung the crown ahead of the face. Roll is idle's, or a future head-tracking host's, through `AngleZ` alone. |
| `ParamEyeBallX/Y` | host wins outright while a gaze exists — additive would visibly wander off the cursor instead of reading as "looking at you". |
| `ParamMouthOpenY` | host-owned: lip-sync writes it straight to the player, outside the blend; no idle driver touches it. |
| everything else (blink, breath, hair-sway/chain outputs) | pass through — idle or physics own it; the host never writes it through the blend. |

A gaze persists until the next one: `lookAt()` / `updateViewWithMouse()` only
store the target, and there is no "gaze released" signal in the `Renderer`
contract (`RenderManager` suspends mouse tracking; it never tells the renderer
an AI gaze ended). Before the first gaze the character is fully idle — drift,
sway, blink, breath, all from `IkiMotion`.

**Not supported yet:** expressions and motions. Iki has no expression/motion
concept, so this adapter omits `playExpression` / `playMotionByGroup` /
`getAvailableExpressions` / `getAvailableMotionGroups`, and `RenderManager`
feature-detects their absence and skips them.
