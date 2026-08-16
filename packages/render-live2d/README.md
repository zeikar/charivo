# @charivo/render-live2d

Live2D Cubism renderer for Charivo.

This package is the concrete browser renderer for Live2D models. In most apps
you use it together with `@charivo/render`.

## Install

```bash
pnpm add @charivo/render-live2d @charivo/render
```

## Usage

```ts
import { createLive2DRenderer } from "@charivo/render-live2d";
import { createRenderManager } from "@charivo/render";

const renderer = createLive2DRenderer({ canvas });
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel?.("/live2d/hiyori/hiyori.model3.json");
```

## Public Surface

The renderer exposes:

- `initialize()`
- `loadModel(modelPath)`
- `render(message, character?)`
- `destroy()`
- `getAvailableExpressions()`
- `getAvailableMotionGroups()`
- `playExpression(expressionId)`
- `stopExpression()`
- `playMotionByGroup(group, index)`
- `lookAt({ x, y })`

When used through `@charivo/render`, realtime lip sync, mouse tracking,
and gaze are handled for you.

## License

**Not MIT.** This package is a composite work: Charivo-authored code is MIT, but
the published bundle also contains Live2D Cubism Core (Live2D Proprietary
Software License) and Cubism Framework / sample-derived code (Live2D Open
Software License). Both are bundled as permitted — `live2dcubismcore.min.js` is
listed as Redistributable Code in `Core/RedistributableFiles.txt` — and the
bundle carries a notice banner that must not be stripped.

Shipping a product built on this package requires a **Live2D Publication License
Agreement** (also marketed as the *Cubism SDK Release License* — the same
instrument). Small users may be exempt, but **that exemption does not cover an
"Expandable Application"**, and this package — a renderer that loads arbitrary
models — plausibly is one regardless of your revenue. Publishing an Expandable
Application additionally needs Live2D's prior approval.

Charivo has not sought that approval and cannot grant it. See
[LICENSE.md](./LICENSE.md) for the clause-by-clause breakdown before you ship.
