# @charivo/stt-transcriber-remote

Remote HTTP STT (Speech-to-Text) transcriber for Charivo (client-side, production-ready).

## Overview

This transcriber sends recorded audio to your server API for transcription, keeping API keys and credentials secure on the server side. **Recommended for production use.**

## Architecture

```
Browser → RemoteSTTTranscriber → Your Server → OpenAI/Google/etc.
```

## Installation

```bash
pnpm add @charivo/stt-transcriber-remote @charivo/core
```

## Usage

### Basic Setup

```typescript
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";
import { createSTTManager } from "@charivo/stt-core";

// Client-side: no API key needed
const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt" // Your server endpoint
});

const sttManager = createSTTManager(transcriber);

// Start recording
await sttManager.start();

// Stop and transcribe
const transcription = await sttManager.stop();
console.log("User said:", transcription);
```

### Custom Endpoint

```typescript
const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "https://your-api.com/transcribe"
});
```

### With Language Option

```typescript
// Start recording with language hint
await sttManager.start({ language: "es" });

// Or pass during transcription
const text = await transcriber.transcribe(audioBlob, {
  language: "es"
});
```

## API Reference

### Configuration

```typescript
interface RemoteSTTConfig {
  /** API endpoint URL (default: "/api/stt") */
  apiEndpoint?: string;
}
```

### Methods

#### `startRecording(options?): Promise<void>`
Start recording audio from microphone.

```typescript
await transcriber.startRecording({ language: "en" });
```

#### `stopRecording(): Promise<string>`
Stop recording and send audio to server for transcription.

```typescript
const transcription = await transcriber.stopRecording();
console.log("User said:", transcription);
```

Returns the transcribed text from your server.

#### `isRecording(): boolean`
Check if currently recording.

```typescript
if (transcriber.isRecording()) {
  console.log("Recording in progress...");
}
```

## Server Implementation

You need to implement a server endpoint that accepts audio and returns transcription. Here are examples:

### Next.js API Route

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

    const audioBlob = new Blob([await audioFile.arrayBuffer()]);
    const transcription = await provider.transcribe(audioBlob, { language });

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

### Express.js

```typescript
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

    const audioBlob = new Blob([req.file.buffer]);
    const transcription = await provider.transcribe(audioBlob, {
      language: req.body.language
    });
    
    res.json({ transcription });
  } catch (error) {
    res.status(500).json({ error: 'Transcription failed' });
  }
});
```

### Custom API (Python/Flask)

```python
from flask import Flask, request, jsonify
import openai

app = Flask(__name__)
openai.api_key = os.environ["OPENAI_API_KEY"]

@app.route('/api/stt', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    
    audio_file = request.files['audio']
    language = request.form.get('language')
    
    transcript = openai.Audio.transcribe(
        model="whisper-1",
        file=audio_file,
        language=language
    )
    
    return jsonify({'transcription': transcript['text']})
```

## Expected Server Response

Your server endpoint should return JSON in this format:

```json
{
  "transcription": "Hello, how can I help you today?"
}
```

## Error Handling

```typescript
try {
  const transcription = await transcriber.transcribe(audioBlob);
} catch (error) {
  if (error.message.includes('404')) {
    console.error("API endpoint not found");
  } else if (error.message.includes('500')) {
    console.error("Server transcription failed");
  } else {
    console.error("Network error:", error);
  }
}
```

## Complete Example

### Client

```typescript
import { Charivo } from "@charivo/core";
import { createSTTManager } from "@charivo/stt-core";
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";
import { createLLMManager } from "@charivo/llm-core";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";

// Setup Charivo
const charivo = new Charivo();

// Setup LLM
const llmClient = createRemoteLLMClient({
  apiEndpoint: "/api/llm"
});
const llmManager = createLLMManager(llmClient);
charivo.attachLLM(llmManager);

// Setup STT
const sttTranscriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt"
});
const sttManager = createSTTManager(sttTranscriber);
charivo.attachSTT(sttManager);

// Voice conversation
await sttManager.start();
const userMessage = await sttManager.stop();
await charivo.userSay(userMessage);
// → Character responds
```

### Server

```typescript
// app/api/stt/route.ts
import { createOpenAISTTProvider } from "@charivo/stt-provider-openai";

const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const audioFile = formData.get('audio') as File;
  
  const audioBlob = new Blob([await audioFile.arrayBuffer()]);
  const transcription = await provider.transcribe(audioBlob);
  
  return NextResponse.json({ transcription });
}
```

## Benefits

✅ **Secure**: API keys stay on the server  
✅ **Flexible**: Use any STT provider on the server  
✅ **Cost Control**: Monitor and limit usage  
✅ **Scalable**: Add caching, rate limiting, etc.  
✅ **Production-Ready**: Designed for real applications

## Audio Format

The transcriber sends audio in the format recorded by the browser (typically WebM). Make sure your server can handle this format, or convert it if needed.

```typescript
// Server-side format conversion example (if needed)
import ffmpeg from 'fluent-ffmpeg';

// Convert WebM to WAV
await new Promise((resolve, reject) => {
  ffmpeg(audioBuffer)
    .toFormat('wav')
    .on('end', resolve)
    .on('error', reject)
    .save('output.wav');
});
```

## Integration with Charivo

```typescript
import { Charivo } from "@charivo/core";

const charivo = new Charivo();

// Attach remote STT
const sttManager = createSTTManager(
  createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" })
);
charivo.attachSTT(sttManager);

// Voice input
const sttManager = charivo.getSTTManager();
await sttManager.start();
const text = await sttManager.stop();
await charivo.userSay(text);
```

## Performance Tips

1. **Use compression**: Compress audio before sending to reduce upload time
2. **Show progress**: Display upload/transcription progress to users
3. **Handle network errors**: Implement retry logic for failed requests
4. **Cache results**: Cache common phrases on the server

## Browser Compatibility

Works in all modern browsers that support:
- MediaRecorder API
- getUserMedia API
- Fetch API

## Related Packages

- [`@charivo/stt-core`](../stt-core) - STT core functionality
- [`@charivo/stt-provider-openai`](../stt-provider-openai) - Server-side OpenAI provider
- [`@charivo/stt-transcriber-openai`](../stt-transcriber-openai) - Client-side OpenAI transcriber (testing only)

## License

MIT
