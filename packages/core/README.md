# @charivo/core

Core types, interfaces, and event bus for the Charivo framework.

## Features

- 🎯 **Core Types** - Shared types for messages, characters, and configuration
- 🔌 **Interface Definitions** - Standard interfaces for LLM, TTS, and Renderer
- 📡 **Event Bus** - Type-safe event system for component communication
- 🎨 **Extensible** - Build custom clients, players, and providers

## Installation

```bash
pnpm add @charivo/core
```

## Usage

### Basic Setup

```typescript
import { Charivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";
import { createTTSManager } from "@charivo/tts-core";
import { createRenderManager } from "@charivo/render-core";
import { OpenAILLMClient } from "@charivo/llm-client-openai";
import { OpenAITTSPlayer } from "@charivo/tts-player-openai";
import { Live2DRenderer } from "@charivo/render-live2d";

// Initialize Charivo
const charivo = new Charivo();

// Setup LLM
const llmClient = new OpenAILLMClient({ apiKey: "your-api-key" });
const llmManager = createLLMManager(llmClient);
charivo.attachLLM(llmManager);

// Setup TTS
const ttsPlayer = new OpenAITTSPlayer({ apiKey: "your-api-key" });
const ttsManager = createTTSManager(ttsPlayer);
charivo.attachTTS(ttsManager);

// Setup Renderer
const renderer = new Live2DRenderer({ canvas });
await renderer.initialize();
await renderer.loadModel("/live2d/model.model3.json");
const renderManager = createRenderManager(renderer);
charivo.attachRenderer(renderManager);

// Add character
charivo.addCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful AI assistant"
});

// Start chatting
await charivo.userSay("Hello!", "hiyori");
```

### Event Bus

```typescript
import { EventBus } from "@charivo/core";

const eventBus = new EventBus();

// Subscribe to events
eventBus.on("tts:audio:start", (data) => {
  console.log("TTS started", data.audioElement);
});

eventBus.on("tts:audio:end", () => {
  console.log("TTS ended");
});

// Emit events
eventBus.emit("tts:audio:start", { audioElement });
eventBus.emit("tts:audio:end", {});
```

## Core Types

### Character

```typescript
interface Character {
  id: string;
  name: string;
  personality: string;
  traits?: string[];
  background?: string;
  instructions?: string[];
}
```

### Message

```typescript
interface Message {
  id: string;
  content: string;
  timestamp: Date;
  type: "user" | "character" | "system";
}
```

### MotionType

```typescript
type MotionType = "greeting" | "happy" | "thinking" | "talk";
```

## Core Interfaces

### LLMManager

```typescript
interface LLMManager {
  setCharacter(character: Character): void;
  getCharacter(): Character | null;
  clearHistory(): void;
  getHistory(): Message[];
  generateResponse(message: Message): Promise<string>;
}
```

### TTSManager

```typescript
interface TTSManager {
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): Promise<void>;
  setVoice(voice: string): void;
  isSupported(): boolean;
  setEventEmitter?(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void;
}
```

### RenderManager

```typescript
interface RenderManager {
  initialize(): Promise<void>;
  render(message: Message, character?: Character): Promise<void>;
  setCharacter(character: Character): void;
  destroy(): Promise<void>;
  loadModel?(modelPath: string): Promise<void>;
  setMessageCallback?(callback: MessageCallback): void;
}
```

### Renderer

```typescript
interface Renderer {
  initialize(): Promise<void>;
  render(message: Message, character?: Character): Promise<void>;
  destroy(): Promise<void>;
  loadModel?(modelPath: string): Promise<void>;
  playMotion?(motionType: MotionType): void;
  animateExpression?(motionType: MotionType): void;
  setRealtimeLipSync?(enabled: boolean): void;
  updateRealtimeLipSyncRms?(rms: number): void;
}
```

## Architecture

The Charivo framework follows a modular architecture:

```
Charivo (orchestrator)
├─ LLMManager (stateful)
│  └─ LLMClient (stateless)
│
├─ TTSManager (stateful)
│  └─ TTSPlayer (stateless)
│
└─ RenderManager (stateful)
   └─ Renderer (stateless)
```

### Manager Pattern

- **Managers**: Stateful components that handle business logic, state management, and coordination
- **Clients/Players/Renderers**: Stateless components that handle pure operations (API calls, audio playback, rendering)

This separation allows:
- Easy testing (mock the stateless components)
- Flexibility (swap implementations without changing business logic)
- Reusability (use clients independently or with managers)

## Creating Custom Implementations

### Custom LLM Client

```typescript
import { LLMClient } from "@charivo/core";

class MyLLMClient implements LLMClient {
  async call(messages: Array<{role: string, content: string}>): Promise<string> {
    // Call your LLM API
    return "Response from my LLM";
  }
}
```

### Custom TTS Player

```typescript
import { TTSPlayer, TTSOptions } from "@charivo/core";

class MyTTSPlayer implements TTSPlayer {
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // Play audio
  }

  async stop(): Promise<void> {
    // Stop playback
  }

  setVoice(voice: string): void {
    // Set voice
  }

  isSupported(): boolean {
    return true;
  }
}
```

### Custom Renderer

```typescript
import { Renderer, Message, Character, MotionType } from "@charivo/core";

class MyRenderer implements Renderer {
  async initialize(): Promise<void> {
    // Setup renderer
  }

  async render(message: Message, character?: Character): Promise<void> {
    // Render the message
  }

  async destroy(): Promise<void> {
    // Cleanup
  }

  // Optional methods
  playMotion?(motionType: MotionType): void {
    // Play motion
  }
}
```

## Events

### TTS Events

- `tts:audio:start` - Emitted when TTS starts playing
  ```typescript
  { audioElement: HTMLAudioElement }
  ```

- `tts:audio:end` - Emitted when TTS stops playing
  ```typescript
  {}
  ```

## License

MIT
