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
a canvas keeps the WebGL context its first renderer created, and the Iki
engine needs a stencil buffer that a context created for Live2D lacks. The
[web demo](./examples-web.md) does this, and opens on an Iki character with
[`?character=twin`](https://charivo.vercel.app/?character=twin) or
[`?character=mint`](https://charivo.vercel.app/?character=mint).

## What `@charivo/render` Adds

- character text rendering
- `tts:audio:start` and `tts:audio:end`
- `tts:lipsync:update`
- `avatar:expression`
- `avatar:motion` — may carry `muteSound`, which plays the motion without its
  baked-in sample clip. `@charivo/avatar` sets it on tool-call motions and on
  text-driven director motions so a Cubism sample's prerecorded voice never
  talks over the character's own; without the flag the clip stays audible.
- `avatar:gaze`
- `avatar:release` — ends a source's live expression or gaze claim, or both
  when it names no channel; see [Claims And Arbitration](#claims-and-arbitration)
- `performance:start` and `performance:end` — mark one line of speech or a
  silent act, so a hold can follow it; nothing built-in emits them yet, and
  an app running its own speech pipeline may
- optional mouse tracking

In normal app code, wire the manager to `Charivo` rather than handling these
events yourself.

## Claims And Arbitration

Expressions and gaze are shown through claims. Each `avatar:expression` or
`avatar:gaze` event is a claim on its channel, and the manager shows the
winner. A claim carries three optional fields, so an event with none of them
is still valid:

```ts
charivo.emit("avatar:expression", {
  expressionId: "F03",
  source: "game",
  priority: "reflex",
  hold: { ms: 1500 },
});
charivo.emit("avatar:release", { source: "game", channel: "expression" });
```

`source` defaults to `"app"` and `priority` to `"explicit"`. `hold` defaults per
channel:

| Channel | Kind | Default hold | Base (no live claim) |
| --- | --- | --- | --- |
| expression | held | speech-scoped, see [Expression Auto-Release](#expression-auto-release) | `stopExpression()`; a renderer without it keeps the last face |
| gaze | held | 1,200 ms | `clearGaze()` when the renderer has it, then local-presence gaze and mouse as before |
| motion | one-shot | none | the model's idle loop |

Lip sync is not a claim channel: `tts:audio:start`, `tts:audio:end` and
`tts:lipsync:update` drive it directly.

### Priority

Priority runs `reflex` > `explicit` > `inferred` > `ambient`, and the rules for
a held channel are:

- One live claim per `source`. A new claim from the same source replaces its
  previous one and counts as the newest.
- The highest priority wins; a tie goes to the newest claim.
- The renderer is called only when the winning value changes. A repeated claim
  for a value that is already showing refreshes that source's hold and replays
  nothing.
- When the winner is released or expires, the next live claim is shown. With
  none left, the channel returns to its base.
- A claim naming an expression the loaded model lacks, or a `hold.ms` that is
  not a positive finite number, is ignored and does not displace that source's
  live claim. So is a claim whose `{ performance }` hold names a performance
  that already ended.

### Holds

| Hold | Released when |
| --- | --- |
| `{ ms }` | the timer fires |
| `"until-release"` | `avatar:release` names its source, the same source claims again, or the manager lets go (`disconnect()`, `destroy()`, `loadModel()`) |
| `{ performance: id }` | `performance:end` arrives for that id. If its start has not been seen, the claim waits up to the 8-second pre-speech window for `performance:start`, then expires; if the id already ended, the claim is dropped |

The manager remembers the last 32 ended performance ids on the bus it is
attached to. An end always records its id, even when its start was never seen
(or was seen after it, since the bus dispatches synchronously), and a start for
a recorded id opens nothing.

`disconnect()` and `destroy()` drop every claim and release the expression at
once, leaving no timer. Swapping to a different bus keeps what is showing, but
the open speech spans can no longer end, so the claims bound to them fall back
to the pre-speech window.

### Motion Priority

A motion is one-shot: it has no source, no hold and nothing to release, only a
priority. The manager keeps no motion priority state. It maps the claim priority
and forwards it, and the renderer decides against the clip that is actually
running, so a displaced motion is simply discarded.

| Claim priority | `MotionPriority` | Live2D | Iki |
| --- | --- | --- | --- |
| `reflex` | `"force"` | cuts any running motion | always plays |
| `explicit`, `inferred` | `"normal"` | declined while a normal or force motion runs (as before) | declined while a force clip runs; replaces a normal clip (as before) |
| `ambient` | `"idle"` | starts only when nothing, the idle loop included, is playing | declined while a normal or force clip runs |

The option is passed only when it is not `"normal"`, so an unflagged call keeps
its old two-argument shape, and a renderer of your own that ignores it plays
every motion, as before.

The same motion requested twice within a second is still dropped as a repeat.
A `reflex` motion skips that check, because the check cannot tell a motion the
renderer declined from one it played. An `ambient` motion is not recorded for it
either, since it is often declined while any clip runs.

## Expression Auto-Release

An expression claimed with no `hold` is speech-scoped. It lasts for the speech
it accompanies and is released when that speech ends, however long it runs, so
the model fades back to its base face over the expression's `FadeOutTime`
(1 second when the `.exp3.json` does not set one) instead of snapping.

A **speech span** is a `performance:start` with `voiced: true` up to its
`performance:end`. While no voiced performance is open, a `tts:audio:start` up
to the next `tts:audio:end` counts as one too, for speech nothing reported as a
performance. A claim binds to the span in progress, or else to the next one that
starts within 8 seconds. If none does, it expires at the end of that window; this
is also what returns the face in text-only setups that never emit
`tts:audio:start` / `tts:audio:end`. An unvoiced performance binds no
speech-scoped claim. The window is not a ceiling on speech: once bound, the
claim lasts until its span ends.

A span's end releases only the claims bound to it. A silent reaction with a
`{ ms }` or `"until-release"` hold outlives unrelated speech, and a mid-line
reflex falls back to the line's own expression when it expires.

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
  beyond the nominal 8-second window.
- This applies when the renderer implements `stopExpression`.
  `@charivo/render-live2d` does, and so does `@charivo/render-iki`, which fades
  over the `.iki` expression's own `fadeOut`; a renderer that omits it keeps
  the expression until something else replaces it, though its claims still
  expire so a lower one can take over.

Idle motion, eye blink, and breath keep running throughout.

## Event Wiring

`RenderManager` intentionally uses `setEventBus(...)`, not
`setEventEmitter(...)`.

Rendering subscribes to upstream events, so it needs the full event bus
contract. This split is part of the public design. Detaching or replacing the
renderer tears down its bus subscriptions and releases any held expression and
gaze via `disconnect()`, so a detached manager stops reacting to events without being
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
switch. Once the latest call has settled, no earlier call may still install its
model; the manager relies on that when it resumes avatar events.

A load releases every held expression and gaze claim first, and the manager
ignores `avatar:expression`, `avatar:motion` and `avatar:gaze` while the latest
`loadModel(...)` call is pending, then admits them again as soon as it resolves
or rejects. An expression id cannot be checked against a catalog that is about
to change, and a gaze target applies to the current model only. A renderer
without `loadModel` is unaffected.

If the renderer exposes optional methods such as `playExpression`,
`stopExpression`, `playMotionByGroup`, `lookAt`, `clearGaze`, or model catalog
getters,
`@charivo/render` will use them automatically. `getAvatarControlCatalog` is
for the app, not the manager: it is where avatar tools read the catalog from
— see [Building The Catalog](./avatar.md#building-the-catalog).

## Gaze Drivers

The render manager arbitrates between three gaze drivers:

1. **AI gaze** — a gaze claim, made by the `avatar:gaze` event from a model's
   look intent. It follows the claim rules above (1,200 ms unless it names a
   hold) and owns the avatar's gaze while any gaze claim is live. When the last
   one ends, the manager calls the renderer's optional `clearGaze()`, which drops
   the target so the renderer's own resting gaze resumes (Iki: the idle gaze;
   Live2D: centre).
2. **Local-presence gaze** — driven by calling `renderManager.setLocalGaze(coords)` from
   the app layer (e.g. webcam face tracking). Suspends mouse cursor tracking
   through a separate local-gaze window while active.
3. **Mouse cursor** — the default continuous mouse-tracking path.

**Priority for cursor-follow:** AI (`avatar:gaze`) > local-presence (`setLocalGaze`) > mouse cursor

**Deliberate taps** yield only to a live gaze claim — local-presence does not
suppress them.

`setLocalGaze` returns `false` (no-op) while AI gaze owns the avatar or when
the renderer has no `lookAt`. A direct `lookAt()`, `setLocalGaze` and the cursor
are not claims, and their target persists as before.

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
- Only the mouse cursor is affected. Live2D taps hit-test where the pointer is, and
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
