# @charivo/tts-player-remote

Remote HTTP TTS player for Charivo framework (client-side).

## ⚠️ Important Security Note

This is a **client-side HTTP player** that calls your server API endpoint, **NOT** external TTS APIs directly. This design keeps your API keys secure on the server side.

## Architecture

```
Browser/Client → RemoteTTSPlayer → Your Server API → External TTS API (OpenAI, etc.)
```

## Installation

```bash
pnpm add @charivo/tts-player-remote @charivo/core
```

## Usage

### 1. Client-side Setup

```typescript
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";
import { createTTSManager } from "@charivo/tts-core";

const player = createRemoteTTSPlayer({
  apiEndpoint: "/api/tts", // Your server endpoint
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd"
});

// Wrap with TTSManager
const ttsManager = createTTSManager(player);
await ttsManager.speak("Hello, world!");
```

### 2. Server-side Implementation (Required)

You must implement a server endpoint that handles the actual TTS API calls. Use `@charivo/tts-provider-openai` for easy setup:

#### OpenAI TTS Backend Example

```typescript
// app/api/tts/route.ts (Next.js)
import { NextRequest, NextResponse } from "next/server";
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

export async function POST(request: NextRequest) {
  try {
    const { text, voice = "alloy", model = "tts-1" } = await request.json();

    const audioBuffer = await provider.generateSpeech(text, { voice, model });

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("TTS API Error:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 }
    );
  }
}
```



## API Reference

### Constructor

```typescript
new RemoteTTSPlayer(config: RemoteTTSConfig)
```

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
}
```

### Methods

#### `speak(text)`
Convert text to speech by calling your server endpoint.

```typescript
await player.speak("Hello, world!");
```

#### `stop()`
Stop current playback.

```typescript
await player.stop();
```

#### `stop()`
Stop current playback.

```typescript
await player.stop();
```

## Backend-specific Usage

### For OpenAI TTS Backend

```typescript
const player = createRemoteTTSPlayer({
  apiEndpoint: "/api/tts",
  defaultVoice: "alloy", // OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
  defaultModel: "tts-1-hd"
});
```

### For Custom Backend

```typescript
const player = createRemoteTTSPlayer({
  apiEndpoint: "/api/custom-tts",
  defaultVoice: "custom-voice-id",
});
```

## Complete Example

### Client-side

```typescript
import { Charivo } from "@charivo/core";
import { createTTSManager } from "@charivo/tts-core";
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";

const charivo = new Charivo();

const player = createRemoteTTSPlayer({
  apiEndpoint: "/api/tts"
});
const ttsManager = createTTSManager(player);

charivo.attachTTS(ttsManager);

// Use it
await charivo.userSay("Hello!", "assistant");
```

### Server-side (Next.js)

```typescript
// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

export async function POST(request: NextRequest) {
  const { text, voice, model } = await request.json();
  const audioBuffer = await provider.generateSpeech(text, { voice, model });
  
  return new NextResponse(audioBuffer, {
    headers: { "Content-Type": "audio/mpeg" }
  });
}
```

## Error Handling

```typescript
try {
  await player.speak("Hello world!");
} catch (error) {
  console.error("TTS failed:", error);
  // Handle network errors, server errors, etc.
}
```

## Why Use Remote Player?

### Security ✅
- API keys stay on server
- No client-side key exposure
- Secure token-based authentication possible

### Flexibility ✅
- Switch TTS providers without client changes
- Server-side caching
- Rate limiting and monitoring
- Custom audio processing

### Cost Control ✅
- Monitor and limit usage
- Implement quotas per user
- Cache common phrases

## Related Packages

- [`@charivo/tts-provider-openai`](../tts-provider-openai) - Server-side OpenAI TTS provider
- [`@charivo/tts-player-web`](../tts-player-web) - Browser Web Speech API player
- [`@charivo/tts-player-openai`](../tts-player-openai) - Direct OpenAI TTS player (not recommended for client)
- [`@charivo/tts-core`](../tts-core) - TTS core functionality

## License

MIT