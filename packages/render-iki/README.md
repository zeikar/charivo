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

// The model file is the catalog: ids, counts and descriptions for the LLM.
const catalog = renderer.getAvatarControlCatalog();
```

(The package-name import resolves to `dist/`, so run
`pnpm --filter @charivo/render-iki build` first.)

## Try it

A runnable local harness lives in [`examples/iki-test`](../../examples/iki-test) —
it drives the Iki hero model through charivo's `RenderManager` + this adapter:
engine idle and hair physics, mouse-follow gaze blended over the sway,
simulated lip-sync, and a button for every expression and motion the file
declares (sent as `avatar:expression` / `avatar:motion` events), with the
catalog printed below. Run `pnpm --filter @charivo/iki-test dev` and open the
Vite URL.

## Public surface

- `initialize()` — create the WebGL player (requires a canvas).
- `loadModel(modelPath)` — fetch + parse an `.iki` model, build the engine's
  `IkiMotion` for it, start the adapter's rAF loop that steps it, then start
  the engine's own render loop.
- `render(message, character?)` — stateless (the engine's rAF draws).
- `destroy()` — stop that loop and free the player.
- `setRealtimeLipSync(enabled)` / `updateRealtimeLipSyncRms(rms)` — drive the
  mouth aperture (`ParamMouthOpenY`) from lip-sync RMS; see "Motion".
- `lookAt({ x, y })` — sets the gaze target (each `-1..1`, `y=1` up); see
  "Motion" for how it meets the engine's motion.
- `updateViewWithMouse` / `handleMouseTap` — the `MouseTrackable` pair for
  cursor-follow. Both are present because `RenderManager` installs mouse
  tracking only when both exist; tap is a no-op (Iki has no tap motions).
- `playExpression(id)` / `stopExpression()` / `playMotionByGroup(group, index)`
  and `getAvailableExpressions()` / `getAvailableMotionGroups()` /
  `getAvatarControlCatalog()` — see "Expressions and motions".

## Expressions and motions

An `.iki` file declares its own expressions (`expressions`: id, description,
fades, parameters) and motion clips (`motions`: clips by group, each with a
description). The adapter hands them to `IkiMotion` and reads the catalog off
the parsed model:

- `playExpression(id)` fades the expression in over its `fadeIn`; one is active
  at a time, and a new one replaces it. `stopExpression()` fades back to the
  base face over its `fadeOut`. `RenderManager` calls it when speech ends
  (`tts:audio:end`) or after its hold fallback.
- `playMotionByGroup(group, index)` plays that clip one-shot, replacing a
  running one. The `muteSound` option has nothing to mute: Iki clips carry no
  audio.
- `getAvailableExpressions()` returns the expression ids and
  `getAvailableMotionGroups()` `{ group: clip count }`; `RenderManager` drops
  `avatar:expression` / `avatar:motion` events that name anything else.
- `getAvatarControlCatalog()` returns the whole `AvatarControlCatalog`:
  those ids and counts plus `expressionDescriptions` (`{ id: description }`)
  and `motionDescriptions` (`{ group: [description by clip index] }`) from the
  file, so `@charivo/avatar`'s tools and instructions describe each choice to
  the LLM with no hand-written descriptions. A map is omitted when the model
  declares nothing of its kind.

Before `loadModel()` resolves (and after `destroy()`) the play methods do
nothing and the catalog is empty, so read the catalog after the load.

## Motion

Idle animation, motion clips, expressions, hair-spring physics and chain
secondary motion are not this adapter's code — they come from
`@ikijs/engine`'s `IkiMotion`, built fresh in `loadModel()` for the loaded
model. The adapter steps it once per rAF tick, registered before the engine's
render loop so the pose is written before the frame is drawn; blends the
host's gaze into what it writes (`src/motion-blend.ts`); and writes lip-sync
last.

Each frame runs in this order, and a later write wins:

| Step | Writes |
| --- | --- |
| 1. Idle (`IkiMotion`) | blink, breath, and the head sway and gaze drift — unless the model declares an `Idle` motion group, whose looping clips replace the sway and drift |
| 2. Clips (`IkiMotion`) | the `Idle` loop, then the one-shot from `playMotionByGroup` over it |
| 3. Expressions (`IkiMotion`) | the active expression, or its fade back to base |
| 4. Host gaze blend (the adapter's sink) | steps 1–3 reach the player through it; see the table below |
| 5. Physics and chains (`IkiMotion`) | hair sway outputs, reading the blended head |
| 6. Gaze fallback (adapter) | the host gaze on any head or eyeball parameter steps 1–3 left unwritten this frame — e.g. an `Idle` loop that doesn't animate the eyes |
| 7. Lip-sync (adapter) | `ParamMouthOpenY`, while lip-sync is enabled |

The gaze blend is a fixed table, keyed by parameter:

| Parameter | Policy |
| --- | --- |
| `ParamAngleX`, `ParamAngleY` | host target (`HEAD_ANGLE_RANGE_DEG = 26` × gaze) **+** what `IkiMotion` wrote: the idle sway, or a clip such as a nod or a shake, which plays on top of where the character is looking. 26° (not the store's full ±30°) leaves headroom so a parked, off-canvas pointer — the normal state under `mouseTracking: "document"` — still shows the sway instead of rectifying into a one-sided twitch. |
| `ParamAngleZ` | pass through — idle roll or a tilt clip; no lean into the turn from the host (a roll riding on the turn swung the crown ahead of the face). |
| `ParamEyeBallX/Y` | host wins outright while a gaze exists — additive would visibly wander off the cursor. An expression that moves the eyes loses them to the gaze. |
| `ParamMouthOpenY` | pass through — an expression may open the mouth. Lip-sync, written after `IkiMotion`, overrides it while enabled; disabling lip-sync closes the mouth and hands it back to the expression or rest. |
| everything else (blink, breath, brows, cheek, hair-sway/chain outputs) | pass through — `IkiMotion` owns it. |

A gaze persists until the next one: `lookAt()` / `updateViewWithMouse()` only
store the target, and there is no "gaze released" signal in the `Renderer`
contract (`RenderManager` suspends mouse tracking; it never tells the renderer
an AI gaze ended). Before the first gaze the character is fully driven by
`IkiMotion`.
