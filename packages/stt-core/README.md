# @charivo/stt-core

Core STT (Speech-to-Text) functionality with audio recording management, transcription coordination, and event emission for Charivo.

## Features

- 🎤 **Audio Recording Management** - Browser audio recording using Web Audio API
- 📡 **Event Bus Integration** - Emit audio events for recording lifecycle
- 🔄 **Transcription Coordination** - Seamless integration with STT transcribers
- 🔌 **Transcriber Agnostic** - Works with any STT transcriber (OpenAI Whisper, Google, custom, etc.)

## Installation

```bash
pnpm add @charivo/stt-core @charivo/core
```

## Usage

### Basic Setup

```typescript
import { createSTTManager } from "@charivo/stt-core";
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

// Create a STT transcriber
const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt"
});

// Wrap with STTManager for recording management
const sttManager = createSTTManager(transcriber);

// Start recording
await sttManager.start();

// Stop recording and get transcription
const transcription = await sttManager.stop();
console.log("User said:", transcription);
```

### With Event Bus

```typescript
import { EventBus } from "@charivo/core";

const eventBus = new EventBus();
const sttManager = createSTTManager(transcriber);

// Connect event bus
sttManager.setEventEmitter({
  emit: (event, data) => eventBus.emit(event, data)
});

// Listen to events
eventBus.on("stt:start", (data) => {
  console.log("Recording started", data);
});

eventBus.on("stt:stop", (data) => {
  console.log("Transcription:", data.transcription);
});

eventBus.on("stt:error", (data) => {
  console.error("STT error:", data.error);
});

// Start recording
await sttManager.start();
// → "stt:start" emitted

// Stop and transcribe
const text = await sttManager.stop();
// → Recording stops
// → Audio is transcribed
// → "stt:stop" emitted with transcription
```

### Custom STT Transcriber

```typescript
import { STTTranscriber, STTOptions } from "@charivo/core";
import { createSTTManager } from "@charivo/stt-core";

class MyCustomSTTTranscriber implements STTTranscriber {
  async transcribe(
    audio: Blob | ArrayBuffer, 
    options?: STTOptions
  ): Promise<string> {
    // Convert audio to format your API expects
    const audioBlob = audio instanceof Blob 
      ? audio 
      : new Blob([audio], { type: "audio/webm" });

    // Call your STT API
    const formData = new FormData();
    formData.append("audio", audioBlob);
    if (options?.language) {
      formData.append("language", options.language);
    }

    const response = await fetch("https://my-stt-api.com/transcribe", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    return data.transcription;
  }
}

const sttManager = createSTTManager(new MyCustomSTTTranscriber());
```

### Check Recording State

```typescript
// Check if currently recording
if (sttManager.isRecording()) {
  console.log("Recording in progress...");
} else {
  console.log("Not recording");
}
```

## API Reference

### `STTManager`

Main class for managing audio recording and transcription.

#### Constructor

```typescript
new STTManager(transcriber: STTTranscriber)
```

#### Methods

##### `setEventEmitter(eventEmitter)`
Connect event emitter for STT event emission.

```typescript
sttManager.setEventEmitter({
  emit: (event, data) => { /* ... */ }
});
```

When set, the manager emits:
- `stt:start` with `{ options?: STTOptions }` when recording starts
- `stt:stop` with `{ transcription: string }` when transcription completes
- `stt:error` with `{ error: Error }` when an error occurs

##### `start(options?)`
Start audio recording from the user's microphone.

```typescript
await sttManager.start();

// With language option
await sttManager.start({ language: "en-US" });
```

Requests microphone permission if not already granted.

##### `stop()`
Stop recording and transcribe audio to text.

```typescript
const transcription = await sttManager.stop();
console.log("User said:", transcription);
```

Returns the transcribed text as a string.

##### `isRecording()`
Check if currently recording.

```typescript
if (sttManager.isRecording()) {
  console.log("Recording...");
}
```

## Events

### `stt:start`

Emitted when audio recording starts.

```typescript
{
  options?: STTOptions
}
```

Use this to:
- Show "recording" indicator
- Disable other audio inputs
- Update UI state

### `stt:stop`

Emitted when audio recording stops and transcription completes.

```typescript
{
  transcription: string
}
```

Use this to:
- Display transcribed text
- Hide "recording" indicator
- Process user input

### `stt:error`

Emitted when an error occurs during recording or transcription.

```typescript
{
  error: Error
}
```

Use this to:
- Show error message to user
- Clean up UI state
- Retry logic

## Integration with Charivo

The STT system integrates seamlessly with the Charivo framework:

```typescript
import { Charivo } from "@charivo/core";
import { createSTTManager } from "@charivo/stt-core";
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

const charivo = new Charivo();

// Setup STT
const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt"
});
const sttManager = createSTTManager(transcriber);
charivo.attachSTT(sttManager);

// Start voice input
await sttManager.start();

// Stop and automatically send to character
const transcription = await sttManager.stop();
await charivo.userSay(transcription);
// → Character responds with voice and animation
```

## Architecture

```
STTManager (stateful)
  ├─ MediaRecorder (Web Audio API)
  ├─ Recording State Management
  ├─ Event Bus Integration
  └─ STTTranscriber (stateless)
      └─ Your STT API
```

## Available Transcribers

### Remote STT Transcriber (Recommended for Production)

```bash
pnpm add @charivo/stt-transcriber-remote
```

```typescript
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt" // Your server endpoint (default)
});
```

Calls your server API to keep credentials secure.

### OpenAI STT Transcriber (Development/Testing Only)

```bash
pnpm add @charivo/stt-transcriber-openai
```

```typescript
import { createOpenAISTTTranscriber } from "@charivo/stt-transcriber-openai";

const transcriber = createOpenAISTTTranscriber({
  apiKey: "your-api-key", // ⚠️ Exposed on client
  defaultLanguage: "en"
});
```

⚠️ **Warning**: API key is exposed on the client. Only use for development/testing.

## Browser Compatibility

STT Manager uses the following browser APIs:
- **MediaRecorder API** - For audio recording
- **getUserMedia API** - For microphone access

Supported browsers:
- Chrome/Edge 49+
- Firefox 29+
- Safari 14.1+
- Opera 36+

## Error Handling

```typescript
try {
  await sttManager.start();
  const transcription = await sttManager.stop();
} catch (error) {
  if (error.name === "NotAllowedError") {
    console.error("Microphone permission denied");
  } else if (error.name === "NotFoundError") {
    console.error("No microphone found");
  } else {
    console.error("STT error:", error);
  }
}
```

Common errors:
- `NotAllowedError` - User denied microphone permission
- `NotFoundError` - No microphone device available
- `NotReadableError` - Microphone is already in use
- Network errors - Transcription API failed

## Best Practices

1. **Request permission early**: Test microphone access before starting recording
2. **Show recording indicator**: Always show visual feedback when recording
3. **Handle errors gracefully**: Provide clear error messages to users
4. **Use remote transcriber**: Keep API keys secure on the server

```typescript
// React example
function VoiceInput() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    try {
      setError(null);
      await sttManager.start();
      setRecording(true);
    } catch (err) {
      setError("Failed to start recording");
    }
  };

  const handleStop = async () => {
    try {
      const text = await sttManager.stop();
      setRecording(false);
      onTranscription(text);
    } catch (err) {
      setError("Failed to transcribe");
      setRecording(false);
    }
  };

  return (
    <div>
      <button onClick={recording ? handleStop : handleStart}>
        {recording ? "Stop" : "Start"} Recording
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

## License

MIT
