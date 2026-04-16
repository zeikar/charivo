# @charivo/render-live2d

Live2D Cubism renderer for Charivo.

This package is the concrete browser renderer for Live2D models. In most apps
you use it together with `@charivo/render-core`.

## Install

```bash
pnpm add @charivo/render-live2d @charivo/render-core
```

## Usage

```ts
import { createLive2DRenderer } from "@charivo/render-live2d";
import { createRenderManager } from "@charivo/render-core";

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
- `playMotionByGroup(group, index)`
- `lookAt({ x, y })`

When used through `@charivo/render-core`, realtime lip sync, mouse tracking,
and gaze are handled for you.

## License Note

This package vendors parts of the Live2D Cubism SDK for Web. Review the Live2D
license terms before shipping or republishing it.
