# @charivo/tts-player-web

Browser-native Text-to-Speech player using Web Speech API. No server or API key required!

## Features

- 🌐 **Browser Native** - Uses built-in Web Speech API
- 🆓 **Free Forever** - No API costs or quotas
- 🚀 **Zero Config** - Works out of the box
- 🎵 **Voice Options** - Multiple built-in voices per language
- ⚡ **Fast** - No network latency

## Installation

```bash
pnpm add @charivo/tts-player-web @charivo/core
```

## Usage

### Basic Setup

```typescript
import { createWebTTSPlayer } from "@charivo/tts-player-web";

const player = createWebTTSPlayer();
await player.initialize();

// Speak!
await player.speak("Hello, world!");
```

### Custom Configuration

```typescript
import { WebTTSPlayer } from "@charivo/tts-player-web";

const player = new WebTTSPlayer({
  lang: "en-US",      // Language
  rate: 1.2,          // Speed (0.1 - 10)
  pitch: 1.0,         // Pitch (0 - 2)
  volume: 0.8         // Volume (0 - 1)
});

await player.initialize();
await player.speak("I speak faster now!");
```

### With TTSManager (Recommended)

```typescript
import { createWebTTSPlayer } from "@charivo/tts-player-web";
import { createTTSManager } from "@charivo/tts-core";

const player = createWebTTSPlayer({ rate: 1.1 });
const ttsManager = createTTSManager(player);

await ttsManager.initialize();
await ttsManager.speak("This is easier!");
```

### Voice Selection

```typescript
// List available voices
const voices = speechSynthesis.getVoices();
voices.forEach(voice => {
  console.log(voice.name, voice.lang);
});

// Use specific voice
const player = new WebTTSPlayer({
  lang: "en-US",
  voiceName: "Google US English" // Depends on browser
});
```

## API Reference

### Constructor

```typescript
new WebTTSPlayer(options?: WebTTSOptions)
```

**Options:**
- `lang?: string` - Language code (default: "en-US")
- `rate?: number` - Speech rate 0.1-10 (default: 1.0)
- `pitch?: number` - Pitch 0-2 (default: 1.0)
- `volume?: number` - Volume 0-1 (default: 1.0)
- `voiceName?: string` - Specific voice name (optional)

### Methods

#### `initialize()`
Initialize the player.

```typescript
await player.initialize();
```

#### `speak(text, options?)`
Convert text to speech.

```typescript
await player.speak("Hello!");

// With custom options for this utterance only
await player.speak("Hello!", {
  rate: 1.5,
  pitch: 1.2
});
```

#### `stop()`
Stop current speech.

```typescript
await player.stop();
```

#### `destroy()`
Clean up the player.

```typescript
await player.destroy();
```

## Language Support

Depends on your browser and OS. Common languages:

| Language | Code |
|----------|------|
| English (US) | en-US |
| English (UK) | en-GB |
| Spanish | es-ES |
| French | fr-FR |
| German | de-DE |
| Italian | it-IT |
| Japanese | ja-JP |
| Korean | ko-KR |
| Chinese (Mandarin) | zh-CN |
| Portuguese | pt-BR |

## Configuration Examples

### Natural Voice

```typescript
const player = createWebTTSPlayer({
  rate: 0.95,
  pitch: 1.05,
  volume: 0.9
});
```

### Fast Robot

```typescript
const player = createWebTTSPlayer({
  rate: 1.5,
  pitch: 1.5,
  volume: 1.0
});
```

### Slow and Deep

```typescript
const player = createWebTTSPlayer({
  rate: 0.8,
  pitch: 0.8,
  volume: 1.0
});
```

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | ✅ Full | Best quality |
| Edge | ✅ Full | Same as Chrome |
| Safari | ✅ Full | Good quality |
| Firefox | ⚠️ Limited | Basic voices only |
| Opera | ✅ Full | Same as Chrome |

## Pros & Cons

### Pros ✅
- **Free** - No API costs
- **Fast** - No network latency
- **Private** - All processing on device
- **Offline** - Works without internet
- **Simple** - Zero configuration

### Cons ❌
- **Voice Quality** - Not as natural as cloud TTS
- **Limited Voices** - Depends on OS/browser
- **No Customization** - Can't train custom voices
- **Browser Dependent** - Quality varies by browser

## When to Use

**Use Web TTS when:**
- 🎯 Building a prototype or demo
- 💰 Budget is a concern
- 🔒 Privacy is important
- 🚀 Need fast, offline TTS

**Use Cloud TTS (OpenAI, etc.) when:**
- 🎵 Need high-quality, natural voices
- 🎨 Want custom voice training
- 🌍 Need consistent quality across platforms
- 💼 Building production apps

## Comparison with OpenAI TTS

| Feature | Web TTS | OpenAI TTS |
|---------|---------|------------|
| **Cost** | Free | $15 per 1M chars |
| **Quality** | Good | Excellent |
| **Latency** | None | ~1-2 seconds |
| **Offline** | ✅ Yes | ❌ No |
| **Setup** | Zero | API key needed |
| **Voice Options** | OS-dependent | 6 voices |

## Example: Mixed Approach

Use Web TTS for development, OpenAI for production:

```typescript
const isDevelopment = process.env.NODE_ENV === "development";

const player = isDevelopment
  ? createWebTTSPlayer()
  : createOpenAITTSPlayer({ apiKey: process.env.OPENAI_API_KEY });

const ttsManager = createTTSManager(player);
```

## Troubleshooting

### No voices available

```typescript
// Wait for voices to load
await new Promise(resolve => {
  if (speechSynthesis.getVoices().length) {
    resolve(null);
  } else {
    speechSynthesis.onvoiceschanged = () => resolve(null);
  }
});
```

### Speech cuts off

This is a known browser bug. Call `speechSynthesis.pause()` and `speechSynthesis.resume()` periodically:

```typescript
// Already handled in WebTTSPlayer implementation
```

### Different voices on different browsers

This is expected. Voices are provided by the OS/browser.

## License

MIT
