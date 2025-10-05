# @charivo/render-live2d

🎨 Simple and powerful Live2D renderer for web applications. A lightweight wrapper around the Live2D Cubism SDK that makes it easy to render Live2D models without dealing with the complex SDK directly.

## Why use this?

The official Live2D Cubism SDK is powerful but complex. This package provides:

- ✨ **Simple API** - Just 3 lines to render a Live2D model
- 🎯 **TypeScript Support** - Full type safety
- 🔌 **Framework Agnostic** - Works with React, Vue, vanilla JS, etc.
- 💋 **Built-in Lip Sync** - Real-time mouth movement with audio
- 🎭 **Motion & Expression Control** - Easy animation control
- 📦 **Zero Configuration** - Works out of the box

## Installation

```bash
pnpm add @charivo/render-live2d @charivo/core
```

You also need to include the Live2D Cubism Core library in your HTML:

```html
<script src="/path/to/live2dcubismcore.min.js"></script>
```

## Quick Start

### Basic Usage (3 lines!)

```typescript
import { createLive2DRenderer } from "@charivo/render-live2d";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

// 1. Create renderer
const renderer = createLive2DRenderer({ canvas });

// 2. Initialize
await renderer.initialize();

// 3. Load model
await renderer.loadModel("/live2d/hiyori/hiyori.model3.json");

// That's it! Your Live2D model is now rendering.
```

### With Motion Control

```typescript
import { Live2DRenderer } from "@charivo/render-live2d";

const renderer = new Live2DRenderer({ canvas });

await renderer.initialize();
await renderer.loadModel("/live2d/model.model3.json");

// Play motions
renderer.playMotion("greeting"); // Wave hello
renderer.playMotion("happy");    // Happy animation
renderer.playMotion("thinking"); // Thinking pose
renderer.playMotion("talk");     // Idle talking

// Animate expressions
renderer.animateExpression("greeting"); // Smile
renderer.animateExpression("happy");    // Big smile
renderer.animateExpression("thinking"); // Surprised
```

### With Lip Sync

```typescript
const renderer = new Live2DRenderer({ canvas });
await renderer.initialize();
await renderer.loadModel("/live2d/model.model3.json");

// Enable lip-sync mode
renderer.setRealtimeLipSync(true);

// Update mouth opening based on audio RMS
// (usually done automatically by RenderManager)
renderer.updateRealtimeLipSyncRms(0.8); // 0.0 = closed, 1.0 = fully open
```

### With RenderManager (Recommended)

For state management, mouse tracking, and automatic lip-sync:

```typescript
import { createLive2DRenderer } from "@charivo/render-live2d";
import { createRenderManager } from "@charivo/render-core";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

const renderer = createLive2DRenderer({ canvas });

// Wrap with RenderManager for automatic motion/lip-sync/mouse-tracking
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document" // Track mouse across entire page
});

// Set character
renderManager.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful AI assistant"
});

// Initialize (sets up mouse tracking automatically)
await renderManager.initialize();
await renderManager.loadModel("/live2d/model.model3.json");

// Render messages (automatic motion inference!)
await renderManager.render({
  id: "1",
  content: "Hello! Nice to meet you!",
  timestamp: new Date(),
  type: "character"
});
```

## API Reference

### `Live2DRenderer`

Main renderer class.

#### Constructor

```typescript
new Live2DRenderer(options?: Live2DRendererOptions)
```

**Options:**
- `canvas?: HTMLCanvasElement` - Canvas element for rendering

#### Methods

##### `initialize()`
Initialize the renderer and start render loop.

```typescript
await renderer.initialize();
```

##### `loadModel(modelPath)`
Load a Live2D model.

```typescript
await renderer.loadModel("/live2d/hiyori/hiyori.model3.json");
```

**Note:** Path should point to the `.model3.json` file. All related assets (textures, motions, etc.) should be in the same directory.

##### `render(message, character?)`
Render a message (usually called by RenderManager).

```typescript
await renderer.render({
  id: "1",
  content: "Hello!",
  timestamp: new Date(),
  type: "character"
});
```

##### `playMotion(motionType)`
Play a motion animation.

```typescript
renderer.playMotion("greeting"); // "greeting" | "happy" | "thinking" | "talk"
```

##### `animateExpression(motionType)`
Animate facial expression.

```typescript
renderer.animateExpression("happy");
```

##### `setRealtimeLipSync(enabled)`
Enable/disable real-time lip-sync mode.

```typescript
renderer.setRealtimeLipSync(true);
```

##### `updateRealtimeLipSyncRms(rms)`
Update mouth opening based on audio RMS value (0.0 - 1.0).

```typescript
renderer.updateRealtimeLipSyncRms(0.5); // Half open
```

##### `destroy()`
Clean up and destroy the renderer.

```typescript
await renderer.destroy();
```

### Types

```typescript
interface Live2DRendererOptions {
  canvas?: HTMLCanvasElement;
}

type MotionType = "greeting" | "happy" | "thinking" | "talk";
```

## Mouse Tracking

Mouse tracking is now managed by `RenderManager` from `@charivo/render-core`. The Live2D renderer implements the `MouseTrackable` interface, which allows RenderManager to automatically set up mouse tracking:

```typescript
import { createLive2DRenderer } from "@charivo/render-live2d";
import { createRenderManager } from "@charivo/render-core";

const renderer = createLive2DRenderer({ canvas });

// RenderManager handles mouse tracking setup
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document" // Track across entire page, or "canvas" for canvas only
});

await renderManager.initialize(); // Mouse tracking is set up here
```

The model's eyes will follow the cursor, and you can tap/click to trigger animations.

## Model Requirements

Your Live2D model should:
- Be in Cubism SDK 4 or 5 format (`.model3.json`)
- Include motion groups: `Idle`, `TapBody` (optional)
- Include expressions: `normal`, `smile`, `surprised` (optional)
- Include hit areas: `Body` (optional, for tap interaction)

## Example Project Structure

```
public/
  live2d/
    hiyori/
      runtime/
        hiyori.model3.json    ← Point to this
        hiyori.moc3
        textures/
          texture_00.png
        motions/
          idle_01.motion3.json
          tap_body_01.motion3.json
        expressions/
          smile.exp3.json
```

## Framework Integration

### React

```tsx
import { useEffect, useRef } from "react";
import { createLive2DRenderer } from "@charivo/render-live2d";

function Live2DComponent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const renderer = createLive2DRenderer({ canvas: canvasRef.current });
    
    renderer.initialize().then(() => {
      return renderer.loadModel("/live2d/model.model3.json");
    });

    return () => {
      renderer.destroy();
    };
  }, []);

  return <canvas ref={canvasRef} width={300} height={300} />;
}
```

### Vue

```vue
<template>
  <canvas ref="canvas" width="300" height="300"></canvas>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { createLive2DRenderer } from "@charivo/render-live2d";

const canvas = ref(null);
let renderer = null;

onMounted(async () => {
  renderer = createLive2DRenderer({ canvas: canvas.value });
  await renderer.initialize();
  await renderer.loadModel("/live2d/model.model3.json");
});

onUnmounted(() => {
  renderer?.destroy();
});
</script>
```

### Vanilla JS

```html
<!DOCTYPE html>
<html>
<head>
  <script src="/live2dcubismcore.min.js"></script>
</head>
<body>
  <canvas id="canvas" width="300" height="300"></canvas>
  
  <script type="module">
    import { createLive2DRenderer } from "@charivo/render-live2d";
    
    const canvas = document.getElementById("canvas");
    const renderer = createLive2DRenderer({ canvas });
    
    await renderer.initialize();
    await renderer.loadModel("/live2d/hiyori/hiyori.model3.json");
  </script>
</body>
</html>
```

## Comparison with Raw SDK

### Before (Raw Cubism SDK)

```typescript
// 100+ lines of boilerplate code
import { CubismFramework, Option } from "@framework/live2dcubismframework";
import { LAppModel } from "./lappmodel";
import { LAppDelegate } from "./lappdelegate";
// ... many more imports

// Complex initialization
const option = new Option();
option.logFunction = console.log;
option.loggingLevel = LogLevel.Verbose;
CubismFramework.startUp(option);
CubismFramework.initialize();

// Manual GL context setup
const gl = canvas.getContext("webgl");
// ... GL setup code

// Manual model loading
const model = new LAppModel();
await model.loadAssets(modelPath);
// ... animation loop setup
// ... matrix calculations
// ... resize handling
// ... etc.
```

### After (@charivo/render-live2d)

```typescript
import { createLive2DRenderer } from "@charivo/render-live2d";

const renderer = createLive2DRenderer({ canvas });
await renderer.initialize();
await renderer.loadModel("/live2d/model.model3.json");
```

**90% less code!** 🎉

## Troubleshooting

### Model not showing

1. Make sure `live2dcubismcore.min.js` is loaded before your app
2. Check that the model path is correct
3. Verify all model assets are accessible (textures, motions, etc.)

### Mouse tracking not working

Make sure you're using `RenderManager` with the correct options:

```typescript
const renderManager = createRenderManager(renderer, {
  canvas: yourCanvas,
  mouseTracking: "document" // or "canvas"
});
await renderManager.initialize(); // This sets up mouse tracking
```

Note: Mouse tracking requires using `RenderManager` from `@charivo/render-core`.

### Performance issues

- Reduce canvas size
- Ensure only one renderer instance per canvas
- Call `destroy()` when component unmounts

## License

MIT

## Credits

- Built on top of [Live2D Cubism SDK](https://www.live2d.com/)
- Sample model: Hiyori from Live2D Inc.
