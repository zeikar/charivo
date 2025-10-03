# @charivo/tts-provider-openai

OpenAI TTS (Text-to-Speech) provider for Charivo framework (server-side).

## ⚠️ Important Security Note

This is a **server-side provider** that directly calls OpenAI TTS API and should **ONLY** be used in Node.js/server environments. Using this in client-side code will expose your API key.

For client-side usage, use [`@charivo/tts-player-remote`](../tts-player-remote) instead.

## Architecture

```
Node.js Server → OpenAITTSProvider → OpenAI TTS API
```

## Installation

```bash
pnpm add @charivo/tts-provider-openai @charivo/core openai
```

## Usage

### Server-side Only

```typescript
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!, // Server environment variable
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd"
});

// Generate audio data
const audioBuffer = await provider.generateSpeech("Hello world!");

// With custom options
const audioBuffer2 = await provider.generateSpeech("Hello!", {
  voice: "nova",
  model: "tts-1-hd"
});
```

### API Endpoint Usage

```typescript
// Express.js example
import express from 'express';
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

const app = express();
const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    const audioBuffer = await provider.generateSpeech(text, { voice });
    
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
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

export async function POST(request: NextRequest) {
  try {
    const { text, voice, model } = await request.json();
    
    const audioBuffer = await provider.generateSpeech(text, {
      voice,
      model
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

### Available Models

- `tts-1` - Standard quality, faster, cheaper
- `tts-1-hd` - High quality, slower, more expensive

### Methods

#### `initialize()`
Initialize the provider.

```typescript
await provider.initialize();
```

#### `generateSpeech(text, options?): Promise<ArrayBuffer>`
Generate audio data from text.

```typescript
const audioBuffer = await provider.generateSpeech("Hello world!", {
  voice: "nova",
  model: "tts-1-hd"
});
```

#### `destroy()`
Clean up the provider.

```typescript
await provider.destroy();
```

## Browser Usage (Not Recommended)

⚠️ **Security Warning**: This provider should NOT be used in browser as it exposes your API key to users.

**Better alternative**: Use [`@charivo/tts-player-remote`](../tts-player-remote) for client-side usage.

## Environment Variables

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

## Error Handling

```typescript
try {
  const audioBuffer = await provider.generateSpeech("Hello world!");
} catch (error) {
  console.error("TTS generation failed:", error);
  // Handle OpenAI API errors
}
```

## Use Cases

- **API Endpoints**: Serve generated audio from your server
- **Secure TTS**: Keep API keys on server, expose via HTTP endpoint
- **Caching**: Cache generated audio to reduce API calls
- **Rate Limiting**: Control TTS usage per user
- **Cost Monitoring**: Track TTS API usage and costs

## Complete Example

### Server (Next.js API Route)

```typescript
// app/api/tts/route.ts
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultVoice: "alloy",
  defaultModel: "tts-1"
});

export async function POST(request: NextRequest) {
  const { text, voice } = await request.json();
  const audioBuffer = await provider.generateSpeech(text, { voice });
  
  return new NextResponse(audioBuffer, {
    headers: { "Content-Type": "audio/mpeg" }
  });
}
```

### Client (uses Remote Player)

```typescript
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";
import { createTTSManager } from "@charivo/tts-core";

const player = createRemoteTTSPlayer({
  apiEndpoint: "/api/tts"
});
const ttsManager = createTTSManager(player);

await ttsManager.speak("Hello from OpenAI!");
```

## Pricing (OpenAI)

- **tts-1**: $15.00 per 1M characters
- **tts-1-hd**: $30.00 per 1M characters

Example: "Hello world!" (12 characters) = $0.00018 (tts-1) or $0.00036 (tts-1-hd)

## Related Packages

- [`@charivo/tts-player-remote`](../tts-player-remote) - Client-side HTTP TTS player
- [`@charivo/tts-player-web`](../tts-player-web) - Browser Web Speech API player
- [`@charivo/tts-core`](../tts-core) - TTS core functionality

## License

MIT