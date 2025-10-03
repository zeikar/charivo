# @charivo/tts-core

Core TTS (Text-to-Speech) functionality with audio playback management, event emission, and state management for Charivo.

## Features

- 🔊 **Audio Playback Management** - Automatic audio element lifecycle management
- 📡 **Event Bus Integration** - Emit audio events for lip-sync coordination
- 🎵 **Streaming Support** - Handle both pre-generated and streaming audio
- 🔌 **Player Agnostic** - Works with any TTS player (OpenAI, Google, Web API, custom, etc.)

## Installation

```bash
pnpm add @charivo/tts-core @charivo/core
```

## Usage

### Basic Setup

```typescript
import { createTTSManager } from "@charivo/tts-core";
import { OpenAITTSPlayer } from "@charivo/tts-player-openai";

// Create a TTS player
const player = new OpenAITTSPlayer({
  apiKey: "your-api-key",
  voice: "nova"
});

// Wrap with TTSManager for state management
const ttsManager = createTTSManager(player);

// Initialize
await ttsManager.initialize();

// Speak
await ttsManager.speak("Hello, how can I help you today?");
```

### With Event Bus (for Lip-Sync)

```typescript
import { EventBus } from "@charivo/core";

const eventBus = new EventBus();
const ttsManager = createTTSManager(player);

// Connect event bus
ttsManager.setEventBus({
  on: (event, callback) => eventBus.on(event, callback),
  emit: (event, data) => eventBus.emit(event, data)
});

// Now when speaking, events are emitted automatically
await ttsManager.speak("Hello!");
// → "tts:audio:start" emitted with { audioElement }
// → Audio plays
// → "tts:audio:end" emitted
```

### Custom TTS Player

```typescript
import { TTSPlayer } from "@charivo/core";
import { createTTSManager } from "@charivo/tts-core";

class MyCustomTTSPlayer implements TTSPlayer {
  async initialize(): Promise<void> {
    // Setup your TTS
  }

  async speak(text: string): Promise<void> {
    // Generate and play audio
    const audioUrl = await this.generateAudio(text);
    const audio = new Audio(audioUrl);
    await audio.play();
  }

  async stop(): Promise<void> {
    // Stop playback
  }

  async destroy(): Promise<void> {
    // Cleanup
  }

  private async generateAudio(text: string): Promise<string> {
    // Call your TTS API
    const response = await fetch("https://my-tts-api.com/synthesize", {
      method: "POST",
      body: JSON.stringify({ text })
    });
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }
}

const ttsManager = createTTSManager(new MyCustomTTSPlayer());
```

### Stopping Playback

```typescript
// Start speaking
const speakPromise = ttsManager.speak("This is a long text...");

// Stop at any time
await ttsManager.stop();

// The speak promise will resolve/reject when stopped
```

## API Reference

### `TTSManager`

Main class for managing TTS playback.

#### Constructor

```typescript
new TTSManager(player: TTSPlayer)
```

#### Methods

##### `setEventBus(eventBus)`
Connect event bus for audio event emission.

```typescript
ttsManager.setEventBus({
  on: (event, callback) => { /* ... */ },
  emit: (event, data) => { /* ... */ }
});
```

When set, the manager emits:
- `tts:audio:start` with `{ audioElement: HTMLAudioElement }` when audio starts
- `tts:audio:end` when audio completes or stops

##### `initialize()`
Initialize the underlying TTS player.

```typescript
await ttsManager.initialize();
```

##### `speak(text)`
Convert text to speech and play.

```typescript
await ttsManager.speak("Hello, world!");
```

##### `stop()`
Stop current playback.

```typescript
await ttsManager.stop();
```

##### `destroy()`
Clean up and destroy the manager.

```typescript
await ttsManager.destroy();
```

## Events

### `tts:audio:start`

Emitted when audio playback starts.

```typescript
{
  audioElement: HTMLAudioElement
}
```

Use this to:
- Connect lip-sync analysis
- Show "speaking" indicator
- Pause other audio

### `tts:audio:end`

Emitted when audio playback ends (naturally or via stop()).

```typescript
{}
```

Use this to:
- Stop lip-sync
- Hide "speaking" indicator
- Resume other audio

## Integration with Render System

The TTS events are designed to work seamlessly with the render system:

```typescript
import { createTTSManager } from "@charivo/tts-core";
import { createRenderManager } from "@charivo/render-core";
import { EventBus } from "@charivo/core";

const eventBus = new EventBus();

// Setup TTS
const ttsManager = createTTSManager(ttsPlayer);
ttsManager.setEventBus(eventBus);

// Setup Renderer
const renderManager = createRenderManager(renderer);
renderManager.setEventBus(eventBus);

// When TTS speaks, renderer automatically syncs lips!
await ttsManager.speak("Hello!");
```

## Architecture

```
TTSManager (stateful)
  ├─ Audio Element Management
  ├─ Event Bus Integration
  ├─ Playback State
  └─ TTSPlayer (stateless)
      └─ Your TTS API
```

## Available Players

### OpenAI TTS Player

```bash
pnpm add @charivo/tts-player-openai
```

```typescript
import { OpenAITTSPlayer } from "@charivo/tts-player-openai";

const player = new OpenAITTSPlayer({
  apiKey: "your-api-key",
  voice: "nova", // alloy, echo, fable, onyx, nova, shimmer
  model: "tts-1" // or "tts-1-hd"
});
```

### Web TTS Player

```bash
pnpm add @charivo/tts-player-web
```

```typescript
import { WebTTSPlayer } from "@charivo/tts-player-web";

const player = new WebTTSPlayer({
  lang: "en-US",
  rate: 1.0,
  pitch: 1.0
});
```

Uses browser's built-in Web Speech API (no API key needed).

### Remote TTS Player

```bash
pnpm add @charivo/tts-player-remote
```

```typescript
import { RemoteTTSPlayer } from "@charivo/tts-player-remote";

const player = new RemoteTTSPlayer({
  endpoint: "https://your-tts-server.com/synthesize"
});
```

## Best Practices

1. **Connect event bus for lip-sync**: Always set event bus if you have a renderer
2. **Handle stop gracefully**: Wrap speak/stop in try-catch
3. **Clean up on unmount**: Call destroy() when component unmounts

```typescript
// React example
useEffect(() => {
  const ttsManager = createTTSManager(player);
  ttsManager.initialize();
  
  return () => {
    ttsManager.destroy();
  };
}, []);
```

4. **Queue management**: If you need to queue multiple texts, implement a queue on top of TTSManager

```typescript
class TTSQueue {
  private queue: string[] = [];
  private speaking = false;

  constructor(private manager: TTSManager) {}

  async add(text: string) {
    this.queue.push(text);
    if (!this.speaking) {
      await this.processQueue();
    }
  }

  private async processQueue() {
    while (this.queue.length > 0) {
      this.speaking = true;
      const text = this.queue.shift()!;
      await this.manager.speak(text);
    }
    this.speaking = false;
  }
}
```

## License

MIT
