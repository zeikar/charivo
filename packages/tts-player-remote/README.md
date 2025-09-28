# @charivo/adapter-tts-remote

Remote HTTP TTS adapter for Charivo framework (client-side).

## ⚠️ Important Security Note

This is a **client-side HTTP adapter** that calls your server API endpoint, **NOT** external TTS APIs directly. This design keeps your API keys secure on the server side.

## Architecture

```
Browser/Client → RemoteTTSAdapter → Your Server API → External TTS API (OpenAI, ElevenLabs, etc.)
```

## Installation

```bash
npm install @charivo/adapter-tts-remote @charivo/core
```

## Usage

### 1. Client-side Setup

```typescript
import { createRemoteTTSAdapter } from "@charivo/adapter-tts-remote";

const ttsAdapter = createRemoteTTSAdapter({
  apiEndpoint: "/api/tts", // Your server endpoint
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd"
});

// Use with Charivo
charivo.attachTTS(ttsAdapter);
```

### 2. Server-side Implementation (Required)

You must implement a server endpoint that handles the actual TTS API calls:

#### OpenAI TTS Backend Example

```typescript
// app/api/tts/route.ts (Next.js)
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { text, voice = "alloy", model = "tts-1", speed = 1.0 } = await request.json();

    const response = await openai.audio.speech.create({
      model: model as "tts-1" | "tts-1-hd",
      voice: voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
      input: text,
      response_format: "mp3",
      speed: Math.max(0.25, Math.min(4.0, speed)),
    });

    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("OpenAI TTS API Error:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 }
    );
  }
}
```

#### ElevenLabs Backend Example

```typescript
// app/api/elevenlabs-tts/route.ts
export async function POST(request: NextRequest) {
  const { text, voice } = await request.json();
  
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY!
    },
    body: JSON.stringify({ text })
  });
  
  const audioBuffer = await response.arrayBuffer();
  return new NextResponse(audioBuffer, {
    headers: { "Content-Type": "audio/mpeg" }
  });
}
```

#### Azure Speech Services Backend Example

```typescript
// app/api/azure-tts/route.ts
export async function POST(request: NextRequest) {
  const { text, voice } = await request.json();
  
  // Azure Speech SDK implementation
  // ... your Azure TTS logic here
}
```

## API Reference

### Configuration Options

```typescript
interface RemoteTTSConfig {
  /** Server API endpoint (default: "/api/tts") */
  apiEndpoint?: string;
  /** Default voice (depends on your server implementation) */
  defaultVoice?: string;
  /** Default model (depends on your server implementation) */
  defaultModel?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Additional request headers */
  headers?: Record<string, string>;
}
```

### Methods

- `speak(text: string, options?: TTSOptions): Promise<void>`
- `stop(): Promise<void>`
- `pause(): Promise<void>`
- `resume(): Promise<void>`
- `setVoice(voiceId: string): void`
- `getAvailableVoices(): Promise<SpeechSynthesisVoice[]>`
- `isSupported(): boolean`
- `setModel(model: string): void`
- `getModel(): string`

## Backend-specific Usage

### For OpenAI TTS Backend

```typescript
const adapter = createRemoteTTSAdapter({
  apiEndpoint: "/api/tts",
  defaultVoice: "alloy", // OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
  defaultModel: "tts-1-hd"
});
```

### For ElevenLabs Backend

```typescript
const adapter = createRemoteTTSAdapter({
  apiEndpoint: "/api/elevenlabs-tts",
  defaultVoice: "21m00Tcm4TlvDq8ikWAM", // ElevenLabs voice ID
});
```

### For Azure Speech Services Backend

```typescript
const adapter = createRemoteTTSAdapter({
  apiEndpoint: "/api/azure-tts",
  defaultVoice: "en-US-AriaNeural", // Azure voice name
});
```

## Error Handling

```typescript
try {
  await ttsAdapter.speak("Hello world!");
} catch (error) {
  console.error("TTS failed:", error);
}
```

## Related Packages

- [`@charivo/adapter-tts-openai`](../adapter-tts-openai) - Server-side OpenAI TTS adapter
- [`@charivo/adapter-tts-web`](../adapter-tts-web) - Browser Web Speech API adapter

## License

MIT