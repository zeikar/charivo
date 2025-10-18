````markdown
# @charivo/stt-transcriber-web

Web Speech API-based STT transcriber for Charivo (browser-native, free).

## Overview

Uses the browser's built-in speech recognition to convert speech to text without requiring any API keys. Perfect for quick prototyping and applications that need real-time voice input.

## Features

- 🎤 **Browser-Native Recognition** - Uses Web Speech API
- 💰 **Free** - No API key required
- ⚡ **Real-Time Recognition** - Continuous speech recognition support
- 🌐 **Multi-Language** - Supports languages available in the browser
- 🔒 **Privacy-Friendly** - No audio data sent to third-party servers (depends on browser)

## Installation

```bash
pnpm add @charivo/stt-transcriber-web
```

## Usage

### Basic Real-Time Recognition

```typescript
import { createWebSTTTranscriber } from "@charivo/stt-transcriber-web";

const transcriber = createWebSTTTranscriber();

// Check browser support
if (!transcriber.isSupportedBrowser()) {
  console.error("This browser doesn't support Web Speech API");
}

// Start real-time speech recognition
const transcript = await transcriber.startContinuous(
  {
    language: "en-US", // Language code
    continuous: false, // false: recognize once, true: continuous
    interimResults: true, // Show interim results
  },
  (interimTranscript) => {
    // Interim results callback
    console.log("Interim:", interimTranscript);
  },
  () => {
    // Recognition ended callback
    console.log("Recognition ended");
  }
);

console.log("Final result:", transcript);
```

### Stopping Recognition

```typescript
// Stop gracefully (returns results so far)
transcriber.stopContinuous();

// Abort immediately (no results)
transcriber.abortContinuous();
```

### With STT Manager (Not Recommended)

Web Speech API doesn't support blob-based audio transcription, so it's not suitable for use with STT Manager's recording functionality.

Instead, use real-time recognition directly, or switch to OpenAI/Remote transcriber if you need blob-based transcription.

```typescript
// ❌ Won't work
const manager = createSTTManager(transcriber);
await manager.start();
const text = await manager.stop(); // Error!

// ✅ Use real-time recognition directly
const text = await transcriber.startContinuous({
  language: "en-US",
  continuous: false,
});
```

## API Reference

### `createWebSTTTranscriber()`
Creates a new Web STT transcriber instance.

```typescript
const transcriber = createWebSTTTranscriber();
```

### `startContinuous(options?, onInterim?, onEnd?)`
Start continuous speech recognition.

```typescript
const transcript = await transcriber.startContinuous(
  {
    language: "en-US",
    continuous: false,
    interimResults: true,
    maxAlternatives: 1
  },
  (interim) => console.log("Interim:", interim),
  () => console.log("Ended")
);
```

**Parameters:**
- `options?: STTOptions` - Recognition options
  - `language?: string` - Language code (e.g., "en-US", "ko-KR")
  - `continuous?: boolean` - Continuous recognition (default: false)
  - `interimResults?: boolean` - Show interim results (default: true)
  - `maxAlternatives?: number` - Max alternatives (default: 1)
- `onInterim?: (transcript: string) => void` - Callback for interim results
- `onEnd?: () => void` - Callback when recognition ends

**Returns:** `Promise<string>` - Final transcript

### `stopContinuous()`
Stop recognition gracefully.

```typescript
transcriber.stopContinuous();
```

### `abortContinuous()`
Abort recognition immediately.

```typescript
transcriber.abortContinuous();
```

### `isSupportedBrowser()`
Check if Web Speech API is supported.

```typescript
if (transcriber.isSupportedBrowser()) {
  console.log("Speech recognition is supported");
}
```

## Browser Support

Web Speech API is supported in:

- ✅ **Chrome/Edge** (Recommended) - Full support
- ✅ **Safari** (Limited) - Basic support
- ❌ **Firefox** - Not supported

See [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API#browser_compatibility) for detailed browser compatibility.

## Supported Languages

Common language codes:

| Language | Code |
|----------|------|
| English (US) | `en-US` |
| English (UK) | `en-GB` |
| Spanish | `es-ES` |
| French | `fr-FR` |
| German | `de-DE` |
| Italian | `it-IT` |
| Japanese | `ja-JP` |
| Korean | `ko-KR` |
| Chinese (Simplified) | `zh-CN` |
| Portuguese | `pt-BR` |

The available languages depend on the browser and operating system.

## Limitations

1. **No Blob-Based Recognition**: Web Speech API cannot transcribe pre-recorded audio files
2. **Internet Required**: Most browsers process speech recognition on their servers
3. **Browser-Dependent**: Recognition quality and supported languages vary by browser
4. **Privacy Concerns**: Audio may be sent to browser vendor's servers (Chrome sends to Google)

**For blob-based transcription**, use:
- [`@charivo/stt-transcriber-remote`](../stt-transcriber-remote) - Recommended for production
- [`@charivo/stt-transcriber-openai`](../stt-transcriber-openai) - Testing only

## When to Use

### Use Web STT Transcriber when:
- 🚀 Quick prototyping
- 💰 No budget for STT API
- ⚡ Need real-time recognition
- 🏠 Personal projects

### Use Remote/OpenAI Transcriber when:
- 📹 Need to transcribe recorded audio
- 🎯 Need consistent quality across browsers
- 🔐 Need more control over data privacy
- 🌐 Production applications

## Complete Example

```typescript
import { createWebSTTTranscriber } from "@charivo/stt-transcriber-web";

const transcriber = createWebSTTTranscriber();

// Check support
if (!transcriber.isSupportedBrowser()) {
  alert("Your browser doesn't support speech recognition");
} else {
  // Start recognition
  try {
    const result = await transcriber.startContinuous(
      {
        language: "en-US",
        continuous: false,
        interimResults: true
      },
      (interim) => {
        console.log("Speaking:", interim);
      },
      () => {
        console.log("Recognition ended");
      }
    );
    
    console.log("You said:", result);
  } catch (error) {
    console.error("Recognition error:", error);
  }
}
```

## Error Handling

```typescript
try {
  const transcript = await transcriber.startContinuous({
    language: "en-US"
  });
} catch (error) {
  if (error.message.includes("not-allowed")) {
    console.error("Microphone permission denied");
  } else if (error.message.includes("no-speech")) {
    console.error("No speech detected");
  } else {
    console.error("Recognition error:", error);
  }
}
```

Common error codes:
- `not-allowed` - Microphone permission denied
- `no-speech` - No speech detected
- `aborted` - Recognition aborted
- `network` - Network error

## Related Packages

- [`@charivo/stt-core`](../stt-core) - STT core functionality
- [`@charivo/stt-transcriber-remote`](../stt-transcriber-remote) - Remote HTTP transcriber (recommended)
- [`@charivo/stt-transcriber-openai`](../stt-transcriber-openai) - OpenAI Whisper transcriber

## License

MIT

````
