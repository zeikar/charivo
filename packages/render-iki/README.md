# @charivo/render-iki

[Iki](https://github.com/zeikar/iki) renderer for Charivo. It implements the
charivo `Renderer` (plus the `MouseTrackable` pair) by driving an `.iki` puppet
model through the Iki engine, an open 2D rig engine for the web, so a character
needs no Live2D SDK or license.

In most apps you use it together with `@charivo/render`, the same way as
`@charivo/render-live2d`. To see it running, open the web demo on an Iki
character: [Twin](https://charivo.vercel.app/?character=twin) (a bust) or
[Mint](https://charivo.vercel.app/?character=mint) (a full body).

## Install

```bash
pnpm add @charivo/render-iki @charivo/render
```

[`@ikijs/engine`](https://www.npmjs.com/package/@ikijs/engine) and
[`@ikijs/format`](https://www.npmjs.com/package/@ikijs/format) come with it as
dependencies. The package is browser-only and ESM-only, and MIT like the
engine. Iki is pre-1.0, so each release of this package pins one engine minor
(`^0.12` now) and moves to the next one in a release of its own.

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
await renderManager.loadModel("/hero.iki");

// The model file is the catalog: ids, counts and descriptions for the LLM.
const catalog = renderer.getAvatarControlCatalog();
```

`loadModel()` fetches the path, so serve the `.iki` file from your app (it is
one JSON file with its textures inside). The models the demo uses are in
[`examples/web/public/iki/`](https://github.com/zeikar/charivo/tree/main/examples/web/public/iki);
the [Iki repo](https://github.com/zeikar/iki) documents the format.

## Try it

Besides the web demo, a local harness lives in
[`examples/iki-test`](https://github.com/zeikar/charivo/tree/main/examples/iki-test)
in the charivo repo — it drives an Iki model through charivo's `RenderManager`
and this adapter:
engine idle and hair physics, mouse-follow gaze through the idle's own
eyes-lead, head-follow model, simulated lip-sync, and a button for every expression and motion the file
declares (sent as `avatar:expression` / `avatar:motion` events), with the
catalog printed below. Run `pnpm --filter @charivo/iki-test dev` and open the
Vite URL. It loads Iki's bust hero by default (twin-tails, whose far tail goes
behind the hair on a turn through `IkiPart.occlusion`); `?model=mint` loads a
full body, framed with `setView()` so its `Wave` stays on the canvas. Both
files are the web demo's, under `examples/web/public/iki/`, so there is one
copy of each to refresh.

## Public surface

The package exports `createIkiRenderer(options?)` and the types
`IkiRenderer`, `IkiRendererOptions` (`{ canvas }`) and `IkiView`. The renderer
it returns exposes:

- `initialize()` — create the WebGL player (requires a canvas).
- `loadModel(modelPath)` — fetch + parse an `.iki` model, build the engine's
  `IkiMotion` for it, start the adapter's rAF loop that steps it, then start
  the engine's own render loop. The latest call wins: one whose fetch is still
  out when a later call begins resolves without loading, however late it lands
  (or rejects, if its own fetch or parse fails).
- `render(message, character?)` — stateless (the engine's rAF draws).
- `destroy()` — stop that loop and free the player.
- `setRealtimeLipSync(enabled)` / `updateRealtimeLipSyncRms(rms)` — drive the
  mouth aperture (`ParamMouthOpenY`) from lip-sync RMS; see "Motion".
- `setView(view?)` — frame an `IkiView` (`{ x, y, width, height }`: centre and
  size in model units, `y` up) instead of the model's box, e.g. a full body
  whose raised arm leaves the box; no argument restores the box. The engine's
  `IkiPlayer.setView`, callable before `initialize()` and kept across loads.
  Not part of the `Renderer` contract, so call it on the renderer, not the
  `RenderManager`. `IkiView` is re-exported.
- `lookAt({ x, y })` — sets the gaze target (each clamped to `-1..1`, `y=1`
  up; a non-finite pair is ignored); see "Gaze".
- `setGazeOrigin(origin?)` — `MouseTrackable`'s optional method, the same call
  and units as `@charivo/render-live2d`'s: the point of the model the mouse
  gaze is measured from, as a `GazeOrigin` from `@charivo/render` (fractions of
  the model's canvas, top-left `(0, 0)` to bottom-right `(1, 1)`), e.g. between
  the eyes of a full body; no argument restores the canvas's centre; a
  non-finite `x` or `y` throws. See "Gaze".
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
  running one. The `Renderer` contract's `{ muteSound }` option is accepted and
  ignored: Iki clips carry no audio.
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
render loop so the pose is written before the frame is drawn; hands it the
host's gaze; and writes lip-sync last.

Each frame runs in this order, and a later write wins:

| Step | Writes |
| --- | --- |
| 1. Idle (`IkiMotion`) | blink (and the brows' dip with it, on a model that declares brows), breath, the ambient sway that hair physics follows, and the gaze and head: the eyes hold a point and the head follows it over its own slow drift — unless the model declares an `Idle` motion group, whose looping clips replace the head and gaze |
| 2. Clips (`IkiMotion`) | the `Idle` loop, then the one-shot from `playMotionByGroup` over it |
| 3. Expressions (`IkiMotion`) | the active expression, or its fade back to base |
| 4. Physics and chains (`IkiMotion`) | hair sway outputs, reading the head steps 1–3 wrote |
| 5. Eyes under an `Idle` group (adapter) | `ParamEyeBallX/Y` at the host gaze — only on a model that declares an `Idle` group, and only once a gaze exists |
| 6. Lip-sync (adapter) | `ParamMouthOpenY`, while lip-sync is enabled |

### Gaze

`lookAt()` and `updateViewWithMouse()` do not write head angles. They hand the
target to `IkiMotion.setGazeTarget()`, which holds the idle's gaze on it in
place of the points the idle picks for itself: the eyes go there on stiff
springs and the head turns and nods after them, 10° per unit of gaze, on top of
the idle's drift. A gaze at the edge of the range turns the head about a third
of its ±30°; the eyes carry the rest.

- A one-shot clip replaces the head axes it animates for as long as it runs,
  the gaze follow on them with it: a `Nod` (pitch only) plays at its own keys
  while the head keeps its turn toward the target, and the pitch returns to the
  target over the clip's fade-out. The eyes stay on the target unless the clip
  or an expression drives them, in which case that wins.
- Under a declared `Idle` group the engine's gaze target moves nothing, since
  the group's clips own the head and gaze. The adapter then writes the eyes at
  the target itself (step 5) and leaves the head to the clips. That write is
  the last one, so on such a model the eyes jump to the target with no spring
  and the host gaze beats an expression or clip that moves the eyes — the
  reverse of a model without the group.
- The mouth is the expression's until lip-sync is enabled; lip-sync, written
  after `IkiMotion`, overrides it, and disabling lip-sync closes the mouth and
  hands it back to the expression or rest.

`updateViewWithMouse()` turns the pointer into that target by its offset from
a point, in half-canvases: one half-width to the right is `x = 1`. The point is
the canvas's centre unless `setGazeOrigin()` names one on the model, which the
adapter places on the canvas through the view the engine draws with (so the
point is a fraction of the model's own box, not of a wider view framing it). On
a bust the centre is close enough to the face; on a full body it is the waist,
so a pointer on her face reads as above it and she looks up until the origin is
set between her eyes.

A gaze persists until the next one, across a reload too: there is no "gaze
released" signal in the `Renderer` contract (`RenderManager` suspends mouse
tracking; it never tells the renderer an AI gaze ended), so the adapter never
calls `clearGazeTarget()`. Before the first gaze the character looks where the
idle picks.
