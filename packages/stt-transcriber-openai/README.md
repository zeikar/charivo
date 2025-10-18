# @charivo/stt-transcriber-openai

OpenAI Whisper STT transcriber for Charivo (direct API access).

## ⚠️ Security Warning

This transcriber directly calls OpenAI Whisper API from the client. **Only use for development/testing or in trusted environments**. For production, use [`@charivo/stt-transcriber-remote`](../stt-transcriber-remote) to keep API keys secure on the server.

## Installation

```bash
pnpm add @charivo/stt-transcriber-openai @charivo/core openai
```

## Usage

### Basic Setup

```typescript
import { createOpenAISTTTranscriber } from "@charivo/stt-transcriber-openai";
import { createSTTManager } from "@charivo/stt-core";

// ⚠️ API key will be visible in client code
const transcriber = createOpenAISTTTranscriber({
  apiKey: "your-openai-api-key", // NOT SECURE
  defaultLanguage: "en"
});

const sttManager = createSTTManager(transcriber);

// Start recording
await sttManager.start();

// Stop and transcribe
const transcription = await sttManager.stop();
console.log("User said:", transcription);
```

### Configuration

```typescript
const transcriber = createOpenAISTTTranscriber({
  apiKey: "your-api-key",
  defaultModel: "whisper-1",
  defaultLanguage: "en"  // Optional: specify language for better accuracy
});
```

## API Reference

### Constructor

```typescript
new OpenAISTTTranscriber(config: OpenAISTTTranscriberConfig)
```

**Config:**
- `apiKey: string` - Your OpenAI API key (required)
- `defaultModel?: "whisper-1"` - Model to use (default: "whisper-1")
- `defaultLanguage?: string` - Default language code (e.g., "en", "es", "fr")

### Methods

#### `startRecording(options?)`
Start recording audio from microphone.

```typescript
await transcriber.startRecording();

// With language option
await transcriber.startRecording({ language: "es" });
```

#### `stopRecording()`
Stop recording and transcribe audio to text.

```typescript
const transcription = await transcriber.stopRecording();
console.log("User said:", transcription);
```

#### `isRecording()`
Check if currently recording.

```typescript
if (transcriber.isRecording()) {
  console.log("Recording in progress...");
}
```

## Supported Languages

Whisper supports 99+ languages including:

| Language | Code | Language | Code |
|----------|------|----------|------|
| English | `en` | Spanish | `es` |
| French | `fr` | German | `de` |
| Italian | `it` | Portuguese | `pt` |
| Dutch | `nl` | Russian | `ru` |
| Chinese | `zh` | Japanese | `ja` |
| Korean | `ko` | Arabic | `ar` |

And many more... If not specified, Whisper will auto-detect the language.

## Available Models

- `whisper-1` - OpenAI's Whisper model for speech recognition

## Security Best Practices

### ❌ Not Recommended (Client-side)

```typescript
// API key exposed to users!
const transcriber = createOpenAISTTTranscriber({
  apiKey: "sk-..." // Anyone can see this in DevTools
});
```

### ✅ Recommended (Server-side)

Use remote transcriber + provider pattern:

**Client:**
```typescript
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";
import { createSTTManager } from "@charivo/stt-core";

const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt" // No API key here!
});
const sttManager = createSTTManager(transcriber);
```

**Server:**
```typescript
import { createOpenAISTTProvider } from "@charivo/stt-provider-openai";

const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY // Secure!
});

export async function POST(request) {
  const formData = await request.formData();
  const audioFile = formData.get('audio') as File;
  
  const audioBlob = new Blob([await audioFile.arrayBuffer()]);
  const transcription = await provider.transcribe(audioBlob);
  
  return Response.json({ transcription });
}
```

## When to Use

### Use OpenAI STT Transcriber when:
- 🧪 Prototyping or testing
- 🏠 Personal projects
- 🔒 Running in trusted environment (e.g., Electron app)

### Use Remote Transcriber when:
- 🌐 Production web apps
- 👥 Multi-user applications
- 💰 Need to control costs
- 🔐 Security is important

## Pricing

Same as OpenAI Whisper API:
- **whisper-1**: $0.006 per minute (rounded to the nearest second)

Example: 30 seconds of audio = $0.003

## Audio Format Support

Supports various audio formats:
- MP3
- MP4
- MPEG
- MPGA
- M4A
- WAV
- WEBM

Maximum file size: 25 MB

## Error Handling

```typescript
try {
  await sttManager.start();
  const transcription = await sttManager.stop();
} catch (error) {
  if (error.code === "insufficient_quota") {
    console.error("OpenAI quota exceeded");
  } else if (error.code === "invalid_api_key") {
    console.error("Invalid API key");
  } else if (error.name === "NotAllowedError") {
    console.error("Microphone permission denied");
  } else {
    console.error("Transcription error:", error);
  }
}
```

## Complete Example

```typescript
import { createOpenAISTTTranscriber } from "@charivo/stt-transcriber-openai";
import { createSTTManager } from "@charivo/stt-core";

const transcriber = createOpenAISTTTranscriber({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!, // ⚠️ Only for testing
  defaultLanguage: "en"
});

const sttManager = createSTTManager(transcriber);

// Connect event listeners
sttManager.setEventEmitter({
  emit: (event, data) => {
    if (event === "stt:start") {
      console.log("Recording started");
    } else if (event === "stt:stop") {
      console.log("Transcription:", data.transcription);
    } else if (event === "stt:error") {
      console.error("Error:", data.error);
    }
  }
});

// Start recording (handled internally by transcriber)
await sttManager.start({ language: "en" });

// Stop and get transcription (transcriber handles recording stop + API call)
const text = await sttManager.stop();
console.log("User said:", text);
```

## Integration with Charivo

```typescript
import { Charivo } from "@charivo/core";
import { createSTTManager } from "@charivo/stt-core";
import { createOpenAISTTTranscriber } from "@charivo/stt-transcriber-openai";

const charivo = new Charivo();

// Setup STT
const transcriber = createOpenAISTTTranscriber({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!
});
const sttManager = createSTTManager(transcriber);
charivo.attachSTT(sttManager);

// Voice input flow
await sttManager.start();
const userMessage = await sttManager.stop();
await charivo.userSay(userMessage);
// → Character responds with voice and animation
```

## Performance Tips

1. **Specify language**: Improves accuracy and speed
2. **Use good audio quality**: Clear audio = better transcription
3. **Reduce background noise**: Pre-process if possible
4. **Handle errors gracefully**: Network issues can happen

## Browser Compatibility

Works in browsers that support:
- MediaRecorder API
- getUserMedia API
- Fetch API

Supported browsers:
- Chrome/Edge 49+
- Firefox 29+
- Safari 14.1+
- Opera 36+

## Related Packages

- [`@charivo/stt-transcriber-remote`](../stt-transcriber-remote) - Secure client-side transcriber (recommended)
- [`@charivo/stt-provider-openai`](../stt-provider-openai) - Server-side provider
- [`@charivo/stt-core`](../stt-core) - STT core functionality

## License

MIT
