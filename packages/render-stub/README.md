# @charivo/render-stub

Console renderer for tests, demos, and non-visual debugging.

## Install

```bash
pnpm add @charivo/render-stub
```

## Usage

```ts
import { ConsoleRenderer } from "@charivo/render-stub";
import { createRenderManager } from "@charivo/render-core";

const renderer = new ConsoleRenderer();
const renderManager = createRenderManager(renderer);

await renderManager.initialize();
```

`ConsoleRenderer` logs rendered messages to the console. It is useful when you
want to exercise the Charivo flow without a visual character renderer.
