# @charivo/stt-core

Core STT (Speech-to-Text) functionality with transcription coordination, event emission, and shared utilities for Charivo.

## Features

- 🎤 **Transcription Coordination** - Manages STT transcribers with unified API
- 📡 **Event Bus Integration** - Emit audio events for recording lifecycle
- 🛠️ **MediaRecorder Helper** - Shared audio recording utility for transcribers
- 🔌 **Transcriber Agnostic** - Works with any STT transcriber (Web, OpenAI, Remote, etc.)

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

// Wrap with STTManager for event emission and coordination
const sttManager = createSTTManager(transcriber);

// Start recording (handled internally by transcriber)
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
// → Recording stops (handled by transcriber)
// → Audio is transcribed
// → "stt:stop" emitted with transcription
```

### Custom STT Transcriber

Each transcriber handles recording internally:

```typescript
import { STTTranscriber, STTOptions } from "@charivo/core";
import { MediaRecorderHelper, createSTTManager } from "@charivo/stt-core";

class MyCustomSTTTranscriber implements STTTranscriber {
  private recorder = new MediaRecorderHelper();
  private recordingOptions?: STTOptions;

  async startRecording(options?: STTOptions): Promise<void> {
    this.recordingOptions = options;
    await this.recorder.start();
  }

  async stopRecording(): Promise<string> {
    const audioBlob = await this.recorder.stop();

    // Call your STT API
    const formData = new FormData();
    formData.append("audio", audioBlob);
    if (this.recordingOptions?.language) {
      formData.append("language", this.recordingOptions.language);
    }

    const response = await fetch("https://my-stt-api.com/transcribe", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    this.recordingOptions = undefined;
    return data.transcription;
  }

  isRecording(): boolean {
    return this.recorder.isRecording();
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

Main class for coordinating STT transcription and emitting events.

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
Start audio recording (delegates to transcriber).

```typescript
await sttManager.start();

// With language option
await sttManager.start({ language: "en-US" });
```

The transcriber handles microphone access and recording internally.

##### `stop()`
Stop recording and get transcribed text (delegates to transcriber).

```typescript
const transcription = await sttManager.stop();
console.log("User said:", transcription);
```

Returns the transcribed text as a string.

##### `isRecording()`
Check if currently recording (delegates to transcriber).

```typescript
if (sttManager.isRecording()) {
  console.log("Recording...");
}
```

### `MediaRecorderHelper`

Shared utility for audio recording (used by blob-based transcribers).

#### Methods

##### `start()`
Start audio recording from microphone.

```typescript
const recorder = new MediaRecorderHelper();
await recorder.start();
```

##### `stop()`
Stop recording and return audio blob.

```typescript
const audioBlob = await recorder.stop();
```

##### `isRecording()`
Check if currently recording.

```typescript
if (recorder.isRecording()) {
  console.log("Recording...");
}
```

##### `abort()`
Abort recording immediately without returning data.

```typescript
recorder.abort();
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
import { createWebSTTTranscriber } from "@charivo/stt-transcriber-web";

const charivo = new Charivo();

// Setup STT
const transcriber = createWebSTTTranscriber();
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
STTManager (coordination layer)
  ├─ Event Emission
  └─ STTTranscriber (handles recording internally)
      ├─ WebSTTTranscriber
      │   └─ Web Speech API (real-time)
      ├─ OpenAISTTTranscriber
      │   ├─ MediaRecorderHelper
      │   └─ OpenAI Whisper API
      └─ RemoteSTTTranscriber
          ├─ MediaRecorderHelper
          └─ Your Server API
```

## Available Transcribers

### Web STT Transcriber (Free, Browser-native) ⭐ Recommended

```bash
pnpm add @charivo/stt-transcriber-web
```

```typescript
import { createWebSTTTranscriber } from "@charivo/stt-transcriber-web";

const transcriber = createWebSTTTranscriber();
const sttManager = createSTTManager(transcriber);

// Works with STTManager!
await sttManager.start({ language: "en-US" });
const text = await sttManager.stop();
```

Uses browser's built-in Web Speech API (no API key needed).

**Advantages:**
- 🆓 Completely free
- ⚡ Real-time recognition
- 🔒 No server required
- 🎯 Perfect for development and production

### Remote STT Transcriber (Production-ready)

```bash
pnpm add @charivo/stt-transcriber-remote
```

```typescript
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt" // Your server endpoint
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

STT transcribers use different browser APIs:

**MediaRecorderHelper** (OpenAI/Remote):
- Chrome/Edge 49+
- Firefox 29+
- Safari 14.1+

**Web Speech API** (Web):
- Chrome/Edge (fully supported)
- Safari (limited support)
- Firefox (not supported)

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

1. **Use Web STT for most cases**: Free, fast, and browser-native
2. **Request permission early**: Test microphone access before starting recording
3. **Show recording indicator**: Always show visual feedback when recording
4. **Handle errors gracefully**: Provide clear error messages to users

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
