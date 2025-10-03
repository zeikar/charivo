# @charivo/tts-player-openai

OpenAI TTS player for Charivo (direct API access).

## ⚠️ Security Warning

This player directly calls OpenAI TTS API from the client. **Only use for development/testing or in trusted environments**. For production, use [`@charivo/tts-player-remote`](../tts-player-remote) to keep API keys secure on the server.

## Installation

```bash
pnpm add @charivo/tts-player-openai @charivo/core openai
```

## Usage

### Basic Setup

```typescript
import { createOpenAITTSPlayer } from "@charivo/tts-player-openai";
import { createTTSManager } from "@charivo/tts-core";

// ⚠️ API key will be visible in client code
const player = createOpenAITTSPlayer({
  apiKey: "your-openai-api-key", // NOT SECURE
  voice: "alloy"
});

const ttsManager = createTTSManager(player);
await ttsManager.initialize();
await ttsManager.speak("Hello, world!");
```

### Configuration

```typescript
const player = createOpenAITTSPlayer({
  apiKey: "your-api-key",
  voice: "nova",        // alloy, echo, fable, onyx, nova, shimmer
  model: "tts-1-hd"     // tts-1 or tts-1-hd
});
```

## API Reference

### Constructor

```typescript
new OpenAITTSPlayer(config: OpenAITTSPlayerConfig)
```

**Config:**
- `apiKey: string` - Your OpenAI API key (required)
- `voice?: string` - Voice to use (default: "alloy")
- `model?: string` - Model to use (default: "tts-1")

### Methods

#### `initialize()`
Initialize the player.

```typescript
await player.initialize();
```

#### `speak(text)`
Convert text to speech.

```typescript
await player.speak("Hello!");
```

#### `stop()`
Stop current playback.

```typescript
await player.stop();
```

#### `destroy()`
Clean up the player.

```typescript
await player.destroy();
```

## Available Voices

- `alloy` - Neutral, balanced
- `echo` - Clear, expressive
- `fable` - Warm, engaging
- `onyx` - Deep, authoritative
- `nova` - Bright, energetic
- `shimmer` - Gentle, soothing

## Available Models

- `tts-1` - Standard quality (faster, cheaper)
- `tts-1-hd` - High quality (slower, more expensive)

## Security Best Practices

### ❌ Not Recommended (Client-side)

```typescript
// API key exposed to users!
const player = createOpenAITTSPlayer({
  apiKey: "sk-..." // Anyone can see this in DevTools
});
```

### ✅ Recommended (Server-side)

Use remote player + provider pattern:

**Client:**
```typescript
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";

const player = createRemoteTTSPlayer({
  apiEndpoint: "/api/tts" // No API key here!
});
```

**Server:**
```typescript
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY // Secure!
});

export async function POST(request) {
  const { text } = await request.json();
  const audioBuffer = await provider.generateSpeech(text);
  return new Response(audioBuffer);
}
```

## When to Use

### Use OpenAI TTS Player when:
- 🧪 Prototyping or testing
- 🏠 Personal projects
- 🔒 Running in trusted environment (e.g., Electron app)

### Use Remote Player when:
- 🌐 Production web apps
- 👥 Multi-user applications
- 💰 Need to control costs
- 🔐 Security is important

## Pricing

Same as OpenAI TTS API:
- **tts-1**: $15.00 per 1M characters
- **tts-1-hd**: $30.00 per 1M characters

## Error Handling

```typescript
try {
  await player.speak("Hello!");
} catch (error) {
  if (error.code === "insufficient_quota") {
    console.error("OpenAI quota exceeded");
  } else if (error.code === "invalid_api_key") {
    console.error("Invalid API key");
  } else {
    console.error("TTS error:", error);
  }
}
```

## Related Packages

- [`@charivo/tts-player-remote`](../tts-player-remote) - Secure client-side player (recommended)
- [`@charivo/tts-provider-openai`](../tts-provider-openai) - Server-side provider
- [`@charivo/tts-player-web`](../tts-player-web) - Browser Web Speech API (free)
- [`@charivo/tts-core`](../tts-core) - TTS core functionality

## License

MIT
