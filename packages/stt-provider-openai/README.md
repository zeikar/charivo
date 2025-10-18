# @charivo/stt-provider-openai

OpenAI Whisper STT (Speech-to-Text) provider for Charivo framework (server-side).

## ⚠️ Important Security Note

This is a **server-side provider** that directly calls OpenAI Whisper API and should **ONLY** be used in Node.js/server environments. Using this in client-side code will expose your API key.

For client-side usage, use [`@charivo/stt-transcriber-remote`](../stt-transcriber-remote) instead.

## Architecture

```
Node.js Server → OpenAISTTProvider → OpenAI Whisper API
```

## Installation

```bash
pnpm add @charivo/stt-provider-openai @charivo/core openai
```

## Usage

### Server-side Only

```typescript
import { createOpenAISTTProvider } from "@charivo/stt-provider-openai";

const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!, // Server environment variable
  defaultModel: "whisper-1",
  defaultLanguage: "en"
});

// Transcribe audio data
const transcription = await provider.transcribe(audioBlob);

// With custom options
const transcription2 = await provider.transcribe(audioBlob, {
  language: "es" // Spanish
});
```

### API Endpoint Usage

```typescript
// Express.js example
import express from 'express';
import multer from 'multer';
import { createOpenAISTTProvider } from "@charivo/stt-provider-openai";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

app.post('/api/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const audioBlob = new Blob([req.file.buffer], { 
      type: req.file.mimetype 
    });
    
    const transcription = await provider.transcribe(audioBlob, {
      language: req.body.language
    });
    
    res.json({ transcription });
  } catch (error) {
    res.status(500).json({ error: 'Transcription failed' });
  }
});
```

### Next.js API Route Example

```typescript
// app/api/stt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createOpenAISTTProvider } from "@charivo/stt-provider-openai";

const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const language = formData.get('language') as string | undefined;

    if (!audioFile) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Convert File to Blob
    const audioBlob = new Blob([await audioFile.arrayBuffer()], {
      type: audioFile.type
    });

    const transcription = await provider.transcribe(audioBlob, {
      language
    });

    return NextResponse.json({ transcription });
  } catch (error) {
    console.error("STT error:", error);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 }
    );
  }
}
```

## API Reference

### Configuration Options

```typescript
interface OpenAISTTConfig {
  /** OpenAI API key (required) */
  apiKey: string;
  /** Default OpenAI Whisper model (default: "whisper-1") */
  defaultModel?: "whisper-1";
  /** Default language for transcription (e.g., "en", "es", "fr") */
  defaultLanguage?: string;
  /** Allow browser usage (dangerous - exposes API key) */
  dangerouslyAllowBrowser?: boolean;
}
```

### Available Models

- `whisper-1` - OpenAI's Whisper model for speech recognition

### Supported Languages

Whisper supports 99+ languages including:
- English (`en`)
- Spanish (`es`)
- French (`fr`)
- German (`de`)
- Chinese (`zh`)
- Japanese (`ja`)
- Korean (`ko`)
- And many more...

For best results, specify the language if known. If not specified, Whisper will auto-detect.

### Methods

#### `transcribe(audio, options?): Promise<string>`
Transcribe audio data to text.

```typescript
// With Blob
const transcription = await provider.transcribe(audioBlob);

// With ArrayBuffer
const transcription = await provider.transcribe(audioBuffer);

// With language option
const transcription = await provider.transcribe(audioBlob, {
  language: "es"
});
```

**Parameters:**
- `audio: Blob | ArrayBuffer` - Audio data to transcribe
- `options?: STTOptions` - Optional transcription options
  - `language?: string` - Language code (e.g., "en", "es")

**Returns:** `Promise<string>` - Transcribed text

## Browser Usage (Not Recommended)

⚠️ **Security Warning**: This provider should NOT be used in browser as it exposes your API key to users.

**Better alternative**: Use [`@charivo/stt-transcriber-remote`](../stt-transcriber-remote) for client-side usage.

## Environment Variables

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

## Error Handling

```typescript
try {
  const transcription = await provider.transcribe(audioBlob);
} catch (error) {
  console.error("Transcription failed:", error);
  // Handle OpenAI API errors:
  // - Invalid audio format
  // - API key issues
  // - Rate limiting
  // - Network errors
}
```

## Use Cases

- **API Endpoints**: Provide STT service via your server
- **Secure Transcription**: Keep API keys on server, expose via HTTP endpoint
- **Language Support**: Leverage Whisper's multilingual capabilities
- **Rate Limiting**: Control STT usage per user
- **Cost Monitoring**: Track STT API usage and costs

## Complete Example

### Server (Next.js API Route)

```typescript
// app/api/stt/route.ts
import { createOpenAISTTProvider } from "@charivo/stt-provider-openai";

const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultLanguage: "en"
});

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const audioFile = formData.get('audio') as File;
  const language = formData.get('language') as string | undefined;
  
  const audioBlob = new Blob([await audioFile.arrayBuffer()]);
  const transcription = await provider.transcribe(audioBlob, { language });
  
  return NextResponse.json({ transcription });
}
```

### Client (uses Remote Transcriber)

```typescript
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";
import { createSTTManager } from "@charivo/stt-core";

const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt"
});
const sttManager = createSTTManager(transcriber);

// Start recording
await sttManager.start();

// Stop and get transcription
const text = await sttManager.stop();
console.log("User said:", text);
```

## Pricing (OpenAI Whisper)

- **whisper-1**: $0.006 per minute (rounded to the nearest second)

Example: 30 seconds of audio = $0.003

## Audio Format Support

Whisper supports various audio formats:
- MP3
- MP4
- MPEG
- MPGA
- M4A
- WAV
- WEBM

Maximum file size: 25 MB

## Performance Tips

1. **Use appropriate audio quality**: Higher quality doesn't always mean better transcription
2. **Specify language**: Improves accuracy and speed
3. **Reduce background noise**: Pre-process audio for better results
4. **Chunk long audio**: Split audio files > 10 minutes for faster processing

## Related Packages

- [`@charivo/stt-transcriber-remote`](../stt-transcriber-remote) - Client-side HTTP STT transcriber (recommended)
- [`@charivo/stt-transcriber-openai`](../stt-transcriber-openai) - Client-side OpenAI transcriber (testing only)
- [`@charivo/stt-core`](../stt-core) - STT core functionality

## License

MIT
