# @charivo/stt-transcriber-web

Web Speech API-based STT transcriber for Charivo (browser-native, free).

## Overview

Uses the browser's built-in speech recognition to convert speech to text without requiring any API keys. Perfect for quick prototyping and production applications that need real-time voice input.

## Features

- 🎤 **Browser-Native Recognition** - Uses Web Speech API
- 💰 **Free** - No API key required
- ⚡ **Real-Time Recognition** - Instant speech-to-text conversion
- 🌐 **Multi-Language** - Supports languages available in the browser
- 🔒 **Privacy-Friendly** - Processed in browser (browser-dependent)

## Installation

```bash
pnpm add @charivo/stt-transcriber-web
```

## Usage

### Basic Setup (with STTManager)

```typescript
import { createWebSTTTranscriber } from "@charivo/stt-transcriber-web";
import { createSTTManager } from "@charivo/stt-core";

const transcriber = createWebSTTTranscriber();
const sttManager = createSTTManager(transcriber);

// Check browser support
if (!transcriber.isSupportedBrowser()) {
  console.error("This browser doesn't support Web Speech API");
}

// Start speech recognition
await sttManager.start({ language: "en-US" });

// Stop and get transcription
const transcription = await sttManager.stop();
console.log("User said:", transcription);
```

### Korean Speech Recognition

```typescript
await sttManager.start({ language: "ko-KR" });
const text = await sttManager.stop();
console.log("Korean result:", text);
```

### Direct Usage (without STTManager)

```typescript
// Start recording
await transcriber.startRecording({ language: "en-US" });

// Stop and get result
const text = await transcriber.stopRecording();
console.log("Result:", text);
```

## API Reference

### Constructor

```typescript
new WebSTTTranscriber()
```

Automatically detects browser support.

### Methods

#### `startRecording(options?): Promise<void>`
Start speech recognition.

```typescript
await transcriber.startRecording({ language: "en-US" });
```

**Options:**
- `language?: string` - Language code (e.g., "en-US", "ko-KR", "ja-JP")

#### `stopRecording(): Promise<string>`
Stop recognition and return transcribed text.

```typescript
const transcription = await transcriber.stopRecording();
console.log("Result:", transcription);
```

**Returns:** `Promise<string>` - Transcribed text

#### `isRecording(): boolean`
Check if currently recording.

```typescript
if (transcriber.isRecording()) {
  console.log("Recording in progress...");
}
```

#### `isSupportedBrowser(): boolean`
Check if Web Speech API is supported.

```typescript
if (!transcriber.isSupportedBrowser()) {
  alert("Speech recognition is not supported in this browser");
}
```

## Browser Support

Web Speech API is supported in:

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome/Edge | ✅ Full support | Recommended |
| Safari | ⚠️ Limited support | Some features restricted |
| Firefox | ❌ Not supported | No Web Speech API |

See [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API#browser_compatibility) for detailed browser compatibility.

## Supported Languages

Common language codes:

| Language | Code |
|----------|------|
| English (US) | `en-US` |
| English (UK) | `en-GB` |
| Korean | `ko-KR` |
| Japanese | `ja-JP` |
| Chinese (Simplified) | `zh-CN` |
| Spanish | `es-ES` |
| French | `fr-FR` |
| German | `de-DE` |
| Italian | `it-IT` |
| Portuguese | `pt-BR` |

The available languages depend on the browser and operating system.

## Integration with Charivo

```typescript
import { Charivo } from "@charivo/core";
import { createSTTManager } from "@charivo/stt-core";
import { createWebSTTTranscriber } from "@charivo/stt-transcriber-web";

const charivo = new Charivo();

// Setup STT
const transcriber = createWebSTTTranscriber();
const sttManager = createSTTManager(transcriber);
charivo.attachSTT(sttManager);

// Voice input flow
await sttManager.start({ language: "en-US" });
const userMessage = await sttManager.stop();
await charivo.userSay(userMessage);
// → Character responds with voice and animation
```

## Complete Example (React)

```typescript
import { useState } from "react";
import { createWebSTTTranscriber } from "@charivo/stt-transcriber-web";
import { createSTTManager } from "@charivo/stt-core";

const transcriber = createWebSTTTranscriber();
const sttManager = createSTTManager(transcriber);

function VoiceInput() {
  const [recording, setRecording] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (!transcriber.isSupportedBrowser()) {
      setError("Speech recognition is not supported in this browser");
      return;
    }

    try {
      setError(null);
      await sttManager.start({ language: "en-US" });
      setRecording(true);
    } catch (err) {
      setError("Failed to start recording");
    }
  };

  const handleStop = async () => {
    try {
      const text = await sttManager.stop();
      setTranscription(text);
      setRecording(false);
    } catch (err) {
      setError("Failed to transcribe");
      setRecording(false);
    }
  };

  return (
    <div>
      <button onClick={recording ? handleStop : handleStart}>
        {recording ? "🛑 Stop" : "🎤 Record"}
      </button>
      {recording && <div>🔴 Recording...</div>}
      {transcription && <div>Result: {transcription}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

## Error Handling

```typescript
try {
  await sttManager.start({ language: "en-US" });
  const text = await sttManager.stop();
} catch (error) {
  if (!transcriber.isSupportedBrowser()) {
    console.error("Browser doesn't support Web Speech API");
    // Fallback to OpenAI or Remote transcriber
  } else if (error.name === "NotAllowedError") {
    console.error("Microphone permission denied");
  } else {
    console.error("Speech recognition error:", error);
  }
}
```

Common errors:
- `NotAllowedError` - Microphone permission denied
- `NotFoundError` - No microphone device available
- `AbortError` - Recognition aborted
- Browser not supported - Use OpenAI/Remote transcriber instead

## Advantages

1. **Completely Free**: No API keys or server required
2. **Real-Time**: Fast recognition speed
3. **Privacy**: Audio not sent to external servers (browser-dependent)
4. **Simple**: Works out of the box

## Limitations

1. **Browser Dependency**: Only works well in Chrome/Edge
2. **Internet Required**: Most browsers require internet connection
3. **Accuracy**: May be less accurate than OpenAI Whisper
4. **User Environment**: Depends on user's browser settings

For higher accuracy or Firefox support, use `@charivo/stt-transcriber-openai` or `@charivo/stt-transcriber-remote`.

## When to Use

### Use Web STT Transcriber when:
- 🆓 Cost savings is important
- ⚡ Real-time recognition is needed
- 🔒 Privacy is a priority
- 🎯 Prototyping or personal projects
- ✅ Users primarily use Chrome/Edge

### Use Other Transcribers when:
- 🎯 High accuracy is essential → OpenAI
- 🦊 Firefox support is required → OpenAI/Remote
- 🏢 Consistent quality across browsers → Remote
- 🎬 Need to transcribe recorded audio → OpenAI/Remote

## Performance Tips

1. **Clear Speech**: Speak clearly and at normal pace
2. **Quiet Environment**: Minimize background noise
3. **Specify Language**: Use accurate language codes
4. **Use Chrome/Edge**: Recommended browsers for best results

## Related Packages

- [`@charivo/stt-core`](../stt-core) - STT core functionality
- [`@charivo/stt-transcriber-openai`](../stt-transcriber-openai) - OpenAI Whisper (high accuracy)
- [`@charivo/stt-transcriber-remote`](../stt-transcriber-remote) - Server-side (production)

## License

MIT
