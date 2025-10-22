# @charivo/realtime-core

Core Realtime API functionality with session management and event relay for low-latency voice conversations.

## Features

- 🌐 **Session Management** - Start/stop Realtime API sessions
- 📡 **Event Relay** - Bridge between Realtime client and Charivo event system
- 💋 **Lip-Sync Support** - Real-time RMS values for character mouth animation
- 🔌 **Client Agnostic** - Works with any Realtime client implementation

## Installation

```bash
pnpm add @charivo/realtime-core @charivo/core
```

## Usage

### Basic Setup

```typescript
import { createRealtimeManager } from "@charivo/realtime-core";
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";

// Create a Realtime client
const client = createOpenAIRealtimeClient({
  apiEndpoint: "/api/realtime" // Your WebRTC handshake endpoint
});

// Wrap with RealtimeManager for state management
const realtimeManager = createRealtimeManager(client);

// Start Realtime session
await realtimeManager.startSession({
  model: "gpt-4o-realtime-preview-2024-12-17",
  voice: "verse"
});

// Send text message
await realtimeManager.sendMessage("Hello!");

// Stop session when done
await realtimeManager.stopSession();
```

### With Charivo Integration

```typescript
import { Charivo } from "@charivo/core";
import { createRealtimeManager } from "@charivo/realtime-core";
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";

const charivo = new Charivo();

// Create and attach Realtime manager
const client = createOpenAIRealtimeClient({
  apiEndpoint: "/api/realtime"
});
const realtimeManager = createRealtimeManager(client);
charivo.attachRealtime(realtimeManager);

// Start session
await realtimeManager.startSession({
  model: "gpt-4o-realtime-preview-2024-12-17",
  voice: "verse"
});

// Enable lip-sync on renderer
charivo.emit("tts:audio:start", { audioElement: new Audio() });

// Listen to events
charivo.on("realtime:text:delta", ({ text }) => {
  console.log("Streaming text:", text);
});

charivo.on("tts:lipsync:update", ({ rms }) => {
  console.log("Lip-sync RMS:", rms);
});

// Cleanup
await realtimeManager.stopSession();
charivo.emit("tts:audio:end", {});
charivo.detachRealtime();
```

### Custom Realtime Client

```typescript
import { RealtimeClient } from "@charivo/realtime-core";
import { createRealtimeManager } from "@charivo/realtime-core";

class MyRealtimeClient implements RealtimeClient {
  async connect(): Promise<void> {
    // Connect to your Realtime service
  }

  async disconnect(): Promise<void> {
    // Disconnect
  }

  async sendText(text: string): Promise<void> {
    // Send text message
  }

  async sendAudio(audio: ArrayBuffer): Promise<void> {
    // Send audio chunk
  }

  onTextDelta(callback: (text: string) => void): void {
    // Register text streaming callback
  }

  onAudioDelta(callback: (base64Audio: string) => void): void {
    // Register audio streaming callback
  }

  onLipSyncUpdate?(callback: (rms: number) => void): void {
    // Optional: Register direct RMS callback for WebRTC clients
  }

  onAudioDone(callback: () => void): void {
    // Register audio end callback
  }

  onError(callback: (error: Error) => void): void {
    // Register error callback
  }
}

const realtimeManager = createRealtimeManager(new MyRealtimeClient());
```

## API Reference

### `RealtimeManager`

#### Methods

##### `setEventEmitter(eventEmitter)`

Connect to Charivo's event system.

**Parameters:**
- `eventEmitter` - Object with `emit(event, data)` method

##### `startSession(config)`

Start a Realtime session.

**Parameters:**
- `config.model` - Model name (e.g., "gpt-4o-realtime-preview-2024-12-17")
- `config.voice` - Voice name (e.g., "verse", "alloy", "echo")

**Returns:** `Promise<void>`

##### `stopSession()`

Stop the current Realtime session.

**Returns:** `Promise<void>`

##### `sendMessage(text)`

Send a text message to the Realtime API.

**Parameters:**
- `text` - Message text

**Returns:** `Promise<void>`

##### `sendAudioChunk(audio)`

Send an audio chunk (user's voice).

**Parameters:**
- `audio` - Audio data as ArrayBuffer

**Returns:** `Promise<void>`

### Events

When integrated with Charivo, the following events are emitted:

#### `realtime:text:delta`

Streamed text response from the AI.

**Payload:**
```typescript
{ text: string }
```

#### `tts:lipsync:update`

Real-time lip-sync RMS values (0.0 - 1.0).

**Payload:**
```typescript
{ rms: number }
```

#### `tts:audio:end`

Audio playback finished.

**Payload:**
```typescript
{}
```

#### `realtime:error`

Error occurred during Realtime session.

**Payload:**
```typescript
{ error: Error }
```

## Architecture

The Realtime Manager follows Charivo's **Manager Pattern**:

- **Stateful Manager** (`RealtimeManager`) - Manages session lifecycle and events
- **Stateless Client** (e.g., `OpenAIRealtimeClient`) - Handles WebRTC/WebSocket connection

```
┌─────────────────────┐
│  RealtimeManager    │  ←─ Stateful (session, events)
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  RealtimeClient     │  ←─ Stateless (WebRTC/WS)
└─────────────────────┘
```

### Why This Design?

- **Separation of Concerns**: Manager handles state, client handles protocol
- **Testability**: Easy to mock clients for testing
- **Flexibility**: Swap clients without changing app code
- **Reusability**: Same client can be used in different contexts

## Related Packages

- [@charivo/realtime-client-openai](../realtime-client-openai) - OpenAI Realtime API client with WebRTC
- [@charivo/core](../core) - Core types and interfaces

## License

MIT
