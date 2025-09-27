# @charivo/adapter-tts-openai

OpenAI TTS (Text-to-Speech) adapter for Charivo framework (server-side).

## ⚠️ Important Security Note

This is a **server-side adapter** that directly calls OpenAI TTS API and should **ONLY** be used in Node.js/server environments. Using this in client-side code will expose your API key.

For client-side usage, use [`@charivo/adapter-tts-remote`](../adapter-tts-remote) instead.

## Architecture

```
Node.js Server → OpenAITTSAdapter → OpenAI TTS API
```

## Installation

```bash
npm install @charivo/adapter-tts-openai @charivo/core openai
```

## Usage

### Server-side Only

```typescript
import { createOpenAITTSAdapter } from "@charivo/adapter-tts-openai";

const adapter = createOpenAITTSAdapter({
  apiKey: process.env.OPENAI_API_KEY!, // Server environment variable
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd"
});

// Generate audio data
const audioBuffer = await adapter.generateSpeech("Hello world!");

// Save to file (Node.js only)
await adapter.generateSpeechToFile("Hello world!", "./output.mp3");
```

### API Endpoint Usage

```typescript
// Express.js example
import express from 'express';
import { createOpenAITTSAdapter } from "@charivo/adapter-tts-openai";

const app = express();
const adapter = createOpenAITTSAdapter({
  apiKey: process.env.OPENAI_API_KEY!
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    const audioBuffer = await adapter.generateSpeech(text);
    
    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(audioBuffer));
  } catch (error) {
    res.status(500).json({ error: 'TTS generation failed' });
  }
});
```

### Next.js API Route Example

```typescript
// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createOpenAITTSAdapter } from "@charivo/adapter-tts-openai";

const adapter = createOpenAITTSAdapter({
  apiKey: process.env.OPENAI_API_KEY!
});

export async function POST(request: NextRequest) {
  try {
    const { text, voice, model, speed } = await request.json();
    
    const audioBuffer = await adapter.generateSpeech(text, {
      voice, rate: speed
    });

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 }
    );
  }
}
```

## API Reference

### Configuration Options

```typescript
interface OpenAITTSConfig {
  /** OpenAI API key (required) */
  apiKey: string;
  /** OpenAI API base URL (default: "https://api.openai.com/v1") */
  baseURL?: string;
  /** Default OpenAI voice */
  defaultVoice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  /** Default OpenAI TTS model */
  defaultModel?: "tts-1" | "tts-1-hd";
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Allow browser usage (dangerous - exposes API key) */
  dangerouslyAllowBrowser?: boolean;
}
```

### Available Voices

- `alloy` - Neutral, balanced voice
- `echo` - Clear, expressive voice  
- `fable` - Warm, engaging voice
- `onyx` - Deep, authoritative voice
- `nova` - Bright, energetic voice
- `shimmer` - Gentle, soothing voice

### Server-specific Methods

#### `generateSpeech(text, options?): Promise<ArrayBuffer>`
Generate audio data from text.

```typescript
const audioBuffer = await adapter.generateSpeech("Hello world!", {
  voice: "nova",
  rate: 1.2,
  format: "mp3"
});
```

#### `generateSpeechToFile(text, filePath, options?): Promise<void>`
Generate speech and save to file (Node.js only).

```typescript
await adapter.generateSpeechToFile(
  "Hello world!",
  "./output.mp3",
  { voice: "shimmer", format: "mp3" }
);
```

### Standard TTSAdapter Methods

- `setVoice(voiceId: string): void`
- `getAvailableVoices(): Promise<SpeechSynthesisVoice[]>`
- `isSupported(): boolean`
- `setModel(model: "tts-1" | "tts-1-hd"): void`
- `getModel(): "tts-1" | "tts-1-hd"`

**Note**: `speak()`, `stop()`, `pause()`, `resume()` methods are not implemented as this is a server-side adapter focused on audio generation, not playback.

## Browser Usage (Not Recommended)

⚠️ **Security Warning**: Using this adapter in browser exposes your API key to users.

If absolutely necessary, set `dangerouslyAllowBrowser: true`:

```typescript
// ⚠️ NOT RECOMMENDED - exposes API key
const adapter = createOpenAITTSAdapter({
  apiKey: "your-api-key", // This will be visible to users!
  dangerouslyAllowBrowser: true
});
```

**Better alternative**: Use [`@charivo/adapter-tts-remote`](../adapter-tts-remote) for client-side usage.

## Environment Variables

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

## Error Handling

```typescript
try {
  const audioBuffer = await adapter.generateSpeech("Hello world!");
} catch (error) {
  console.error("TTS generation failed:", error);
}
```

## Use Cases

- **API Endpoints**: Serve generated audio from your server
- **Batch Processing**: Generate multiple audio files
- **Server-side Pre-generation**: Create audio content ahead of time
- **File Export**: Save TTS output to files
- **Streaming**: Generate audio data for streaming applications

## Related Packages

- [`@charivo/adapter-tts-remote`](../adapter-tts-remote) - Client-side HTTP TTS adapter
- [`@charivo/adapter-tts-web`](../adapter-tts-web) - Browser Web Speech API adapter

## License

MIT