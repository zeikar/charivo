# @charivo/render-core

Core rendering functionality with state management, lip-sync coordination, and motion control for Charivo.

## Features

- 🎯 **Stateful Rendering Management** - Manages rendering state, character context, and session
- 🖱️ **Mouse Tracking** - Automatic mouse/touch tracking setup for interactive renderers
- 💋 **Real-time Lip Sync** - Audio analysis and lip-sync coordination with any renderer
- 🎭 **Motion Inference** - Automatic motion type inference from message content
- 🔌 **Renderer Agnostic** - Works with any renderer implementing the `Renderer` interface
- 🎨 **Expression Control** - Automatic expression animation based on context

## Installation

```bash
pnpm add @charivo/render-core @charivo/core
```

## Usage

### Basic Setup

```typescript
import { createRenderManager } from "@charivo/render-core";
import { Live2DRenderer } from "@charivo/render-live2d";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

// Create a renderer (Live2D, 3D, or custom)
const renderer = new Live2DRenderer({ canvas });

// Wrap with RenderManager for state management and mouse tracking
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document" // or "canvas"
});

// Set character
renderManager.setCharacter({
  id: "character-1",
  name: "Hiyori",
  personality: "Cheerful and helpful"
});

// Initialize (this also sets up mouse tracking)
await renderManager.initialize();
await renderManager.loadModel("/path/to/model.model3.json");

// Render messages
await renderManager.render(message, character);
```

### With Event Bus (for TTS lip-sync)

```typescript
import { EventBus } from "@charivo/core";

const eventBus = new EventBus();

// Connect event bus for lip-sync
renderManager.setEventBus({
  on: (event, callback) => eventBus.on(event, callback),
  emit: (event, data) => eventBus.emit(event, data)
});

// When TTS emits audio events, lip-sync happens automatically
eventBus.emit("tts:audio:start", { audioElement });
// ... lip-sync animation in progress
eventBus.emit("tts:audio:end", {});
```

### Custom Renderer

Create your own renderer by implementing the `Renderer` interface:

```typescript
import { Renderer, Message, Character, MotionType } from "@charivo/core";

class MyCustomRenderer implements Renderer {
  async initialize(): Promise<void> {
    // Setup your renderer
  }

  async render(message: Message, character?: Character): Promise<void> {
    // Render the message
  }

  async destroy(): Promise<void> {
    // Cleanup
  }

  // Optional: Motion control
  playMotion?(motionType: MotionType): void {
    // Play motion animation
  }

  animateExpression?(motionType: MotionType): void {
    // Animate expression
  }

  // Optional: Lip-sync support
  setRealtimeLipSync?(enabled: boolean): void {
    // Enable/disable lip-sync
  }

  updateRealtimeLipSyncRms?(rms: number): void {
    // Update mouth opening based on audio RMS
  }
}

// Use with RenderManager
const renderManager = createRenderManager(new MyCustomRenderer());
```

## API Reference

### `RenderManager`

Main class for managing rendering state and coordinating with renderers.

#### Constructor

```typescript
new RenderManager(renderer: Renderer, options?: RenderManagerOptions)
```

**Options:**
- `canvas?: HTMLCanvasElement` - Canvas element for mouse tracking (required if renderer implements `MouseTrackable`)
- `mouseTracking?: "canvas" | "document"` - Mouse tracking scope (default: "canvas")

#### Methods

##### `setEventBus(eventBus)`
Connect event bus for TTS lip-sync coordination.

```typescript
renderManager.setEventBus({
  on: (event, callback) => { /* ... */ },
  emit: (event, data) => { /* ... */ }
});
```

##### `setMessageCallback(callback)`
Set callback for message rendering events.

```typescript
renderManager.setMessageCallback((message, character) => {
  console.log(`Rendered: ${message.content}`);
});
```

##### `setCharacter(character)`
Set the active character.

```typescript
renderManager.setCharacter({
  id: "character-1",
  name: "Hiyori",
  personality: "Cheerful"
});
```

##### `initialize()`
Initialize the underlying renderer and set up mouse tracking (if renderer implements `MouseTrackable`).

```typescript
await renderManager.initialize();
```

##### `loadModel(modelPath)`
Load a model (if renderer supports it).

```typescript
await renderManager.loadModel("/path/to/model.json");
```

##### `render(message, character?)`
Render a message with automatic motion/expression control.

```typescript
await renderManager.render({
  id: "1",
  content: "Hello!",
  timestamp: new Date(),
  type: "character"
}, character);
```

##### `destroy()`
Clean up and destroy the manager.

```typescript
await renderManager.destroy();
```

### `RealTimeLipSync`

Real-time audio analysis for lip-sync animation.

```typescript
import { RealTimeLipSync } from "@charivo/render-core";

const lipSync = new RealTimeLipSync();

// Connect to audio element
lipSync.connectToAudio(audioElement, (rms) => {
  console.log(`Mouth opening: ${rms}`);
  // Update your renderer's mouth parameter
});

// Stop lip-sync
lipSync.stop();

// Cleanup
lipSync.cleanup();
```

### `inferMotionFromMessage`

Infer motion type from message content.

```typescript
import { inferMotionFromMessage } from "@charivo/render-core";

const motionType = inferMotionFromMessage("안녕하세요!"); // "greeting"
const motionType2 = inferMotionFromMessage("That's great!"); // "happy"
const motionType3 = inferMotionFromMessage("This is difficult..."); // "thinking"
const motionType4 = inferMotionFromMessage("Normal conversation"); // "talk"
```

## Motion Types

The system supports four motion types:

- `greeting` - Triggered by greetings like "hello", "안녕"
- `happy` - Triggered by positive words like "좋", "기쁘"
- `thinking` - Triggered by difficult/complex words like "어려", "힘들"
- `talk` - Default for normal conversation

## Architecture

```
RenderManager (stateful)
  ├─ Character Management
  ├─ Mouse Tracking Setup (for MouseTrackable renderers)
  ├─ Event Bus Connection
  ├─ Lip Sync Coordination (RealTimeLipSync)
  ├─ Motion Inference
  └─ Renderer (stateless)
      └─ Your Custom Renderer
```

## Mouse Tracking

RenderManager automatically sets up mouse tracking for renderers that implement the `MouseTrackable` interface:

```typescript
import { MouseTrackable, MouseCoordinates } from "@charivo/render-core";

class MyRenderer implements Renderer, MouseTrackable {
  // ... other Renderer methods

  updateViewWithMouse(coords: MouseCoordinates): void {
    // Update view based on mouse position
    // coords.clientX, coords.clientY
  }

  handleMouseTap(coords: MouseCoordinates): void {
    // Handle mouse/touch tap
  }
}

// RenderManager will automatically set up mouse tracking
const renderManager = createRenderManager(new MyRenderer(), {
  canvas: myCanvas,
  mouseTracking: "document" // Track across entire page
});

await renderManager.initialize(); // Mouse tracking is set up here
```

## License

MIT
