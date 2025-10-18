# 🧩✨ Charivo

**A modular Live2D + LLM framework for interactive character experiences**

Charivo lets you create interactive AI characters with Live2D animations, voice synthesis, and natural language conversations. Mix and match components like LEGO blocks - swap LLM providers, renderers, TTS engines, and more with ease! ✨

## 🎮 [Live Demo](https://charivo.vercel.app/)

Try out Charivo in action at **[charivo.vercel.app](https://charivo.vercel.app/)**

![Charivo Demo](./docs/images/screenshot.png)

## 🎯 Why Charivo?

### Before (Raw Live2D SDK)
```typescript
// 100+ lines of boilerplate
import { CubismFramework } from "@framework/live2dcubismframework";
// ... 10+ more imports
// ... Manual GL context setup
// ... Complex model loading
// ... Animation loop management
// 😫 Hours of setup time
```

### After (Charivo)
```typescript
import { createLive2DRenderer } from "@charivo/render-live2d";

const renderer = createLive2DRenderer({ canvas });
await renderer.initialize();
await renderer.loadModel("/live2d/model.model3.json");
// ✨ 3 lines, done in seconds!
```

## ✨ Features

- 🧩 **Simple Live2D** - 90% less code than raw SDK, just 3 lines to render
- 🤖 **Smart Conversations** - LLM-powered dialogue with emotion understanding
- 🔊 **Voice Synthesis** - Text-to-speech with multiple providers
- 🎤 **Voice Input** - Speech-to-text transcription support
- 💋 **Auto Lip-Sync** - Mouth animation synchronized with speech
- 🎭 **Emotion System** - LLM-driven expressions and motions
- 📦 **Plug & Play** - Modular architecture, swap any component
- ⚡ **TypeScript First** - Full type safety and IntelliSense
- 🎨 **Framework Agnostic** - Works with React, Vue, or vanilla JS
- 🔐 **Secure by Design** - Client/server separation for API keys

## 🚀 Quick Start

### Installation

```bash
# Core packages
npm install @charivo/core @charivo/shared

# Choose your components (see package docs for details)
npm install @charivo/llm-core @charivo/llm-client-remote
npm install @charivo/tts-core @charivo/tts-player-web
npm install @charivo/stt-core @charivo/stt-transcriber-remote
npm install @charivo/render-core @charivo/render-live2d
```

See [📦 Packages](#-packages) section for detailed installation guides.

### Basic Usage

```typescript
import { Charivo, Emotion } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";
import { createTTSManager } from "@charivo/tts-core";
import { createWebTTSPlayer } from "@charivo/tts-player-web";
import { createRenderManager } from "@charivo/render-core";
import { Live2DRenderer } from "@charivo/render-live2d";

// 1. Create Charivo instance
const charivo = new Charivo();

// 2. Setup LLM
const llmClient = createRemoteLLMClient({ apiEndpoint: "/api/chat" });
const llmManager = createLLMManager(llmClient);
charivo.attachLLM(llmManager);

// 3. Setup TTS
const ttsPlayer = createWebTTSPlayer();
const ttsManager = createTTSManager(ttsPlayer);
charivo.attachTTS(ttsManager);

// 4. Setup Renderer
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const renderer = new Live2DRenderer({ canvas });
await renderer.initialize();
await renderer.loadModel("/live2d/hiyori/hiyori.model3.json");
const renderManager = createRenderManager(renderer);
charivo.attachRenderer(renderManager);

// 5. Set character with emotion mappings
charivo.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
  emotionMappings: [
    {
      emotion: Emotion.HAPPY,
      expression: "f02",
      motion: { group: "TapBody", index: 0 }
    },
    // Add more emotions...
  ]
});

// 6. Start conversation!
await charivo.userSay("Hello!");
```

**See the [examples/web](./examples/web) folder for complete implementations.**

## 📦 Packages

Charivo is organized into modular packages. Click on each package to see detailed documentation.

### Core Packages
| Package | Description |
|---------|-------------|
| **[@charivo/core](./packages/core)** | Core framework with event system and character management |
| **[@charivo/shared](./packages/shared)** | Shared utilities and types |

### LLM (Language Model) Packages
| Package | Description | Use Case |
|---------|-------------|----------|
| **[@charivo/llm-core](./packages/llm-core)** | LLM manager with conversation state | Required for LLM functionality |
| [@charivo/llm-client-openai](./packages/llm-client-openai) | OpenAI client | Testing/development only |
| [@charivo/llm-client-remote](./packages/llm-client-remote) | Remote HTTP client | **Recommended for production** |
| [@charivo/llm-client-stub](./packages/llm-client-stub) | Stub client | Testing only |
| [@charivo/llm-provider-openai](./packages/llm-provider-openai) | OpenAI provider | Server-side API routes |

### TTS (Text-to-Speech) Packages
| Package | Description | Use Case |
|---------|-------------|----------|
| **[@charivo/tts-core](./packages/tts-core)** | TTS manager with audio playback | Required for TTS functionality |
| [@charivo/tts-player-web](./packages/tts-player-web) | Web Speech API player | Free, browser-native |
| [@charivo/tts-player-remote](./packages/tts-player-remote) | Remote HTTP player | **Recommended for production** |
| [@charivo/tts-player-openai](./packages/tts-player-openai) | OpenAI TTS player | Testing/development only |
| [@charivo/tts-provider-openai](./packages/tts-provider-openai) | OpenAI TTS provider | Server-side API routes |

### STT (Speech-to-Text) Packages
| Package | Description | Use Case |
|---------|-------------|----------|
| **[@charivo/stt-core](./packages/stt-core)** | STT manager with recording | Required for STT functionality |
| [@charivo/stt-transcriber-remote](./packages/stt-transcriber-remote) | Remote HTTP transcriber | **Recommended for production** |
| [@charivo/stt-transcriber-openai](./packages/stt-transcriber-openai) | OpenAI Whisper transcriber | Testing/development only |
| [@charivo/stt-provider-openai](./packages/stt-provider-openai) | OpenAI Whisper provider | Server-side API routes |

### Rendering Packages
| Package | Description | Use Case |
|---------|-------------|----------|
| **[@charivo/render-core](./packages/render-core)** | Render manager with lip-sync | Required for rendering |
| [@charivo/render-live2d](./packages/render-live2d) | Live2D renderer | **Recommended for 2D characters** |
| [@charivo/render-stub](./packages/render-stub) | Stub renderer | Testing only |

> **📘 Click on any package name** to view detailed documentation, API reference, and examples.

## 🎯 Examples

### Minimal Example (3 lines!)

```typescript
import { createLive2DRenderer } from "@charivo/render-live2d";

const renderer = createLive2DRenderer({ canvas });
await renderer.initialize();
await renderer.loadModel("/live2d/model.model3.json");
```

**90% less code than raw Live2D SDK!** 🎉

### Complete Example

See the [**web demo**](./examples/web) for a full Next.js implementation with:
- ✅ Live2D character rendering
- ✅ LLM conversations with emotion system
- ✅ Text-to-speech with lip-sync
- ✅ Speech-to-text for voice input
- ✅ Client/server separation for security

```bash
cd examples/web
pnpm dev
# Open http://localhost:3000
```

## 🏗️ Architecture Overview

Charivo uses a **Manager Pattern** with clear separation between stateful managers and stateless implementations:

```
┌─────────────────────────────────────┐
│           Your App                  │  ←─ Next.js, React, Vue, etc.
├─────────────────────────────────────┤
│         @charivo/core               │  ←─ Event bus, types, interfaces
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐   │
│  │      LLM Layer              │   │
│  │  ┌──────────────────────┐   │   │
│  │  │  LLMManager          │   │   │  ←─ Stateful (history, character)
│  │  │  (@charivo/llm-core) │   │   │
│  │  └──────────┬───────────┘   │   │
│  │             ▼               │   │
│  │  ┌──────────────────────┐   │   │
│  │  │  LLM Clients         │   │   │  ←─ Stateless (API calls)
│  │  │  OpenAI, Remote, etc │   │   │
│  │  └──────────────────────┘   │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │      TTS Layer              │   │
│  │  ┌──────────────────────┐   │   │
│  │  │  TTSManager          │   │   │  ←─ Stateful (audio, events)
│  │  │  (@charivo/tts-core) │   │   │
│  │  └──────────┬───────────┘   │   │
│  │             ▼               │   │
│  │  ┌──────────────────────┐   │   │
│  │  │  TTS Players         │   │   │  ←─ Stateless (audio playback)
│  │  │  Web, Remote, OpenAI │   │   │
│  │  └──────────────────────┘   │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │      STT Layer              │   │
│  │  ┌──────────────────────┐   │   │
│  │  │  STTManager          │   │   │  ←─ Stateful (recording, events)
│  │  │  (@charivo/stt-core) │   │   │
│  │  └──────────┬───────────┘   │   │
│  │             ▼               │   │
│  │  ┌──────────────────────┐   │   │
│  │  │  STT Transcribers    │   │   │  ←─ Stateless (transcription)
│  │  │  Remote, OpenAI      │   │   │
│  │  └──────────────────────┘   │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │    Rendering Layer          │   │
│  │  ┌──────────────────────┐   │   │
│  │  │  RenderManager       │   │   │  ←─ Stateful (lip-sync, motion)
│  │  │  (@charivo/render-core)│  │   │
│  │  └──────────┬───────────┘   │   │
│  │             ▼               │   │
│  │  ┌──────────────────────┐   │   │
│  │  │  Renderers           │   │   │  ←─ Stateless (rendering)
│  │  │  Live2D, 3D, etc     │   │   │
│  │  └──────────────────────┘   │   │
│  └─────────────────────────────┘   │
├─────────────────────────────────────┤
│      Server-Side Providers          │  ←─ OpenAI API, Custom APIs
└─────────────────────────────────────┘
```

### Key Principles

- **Stateful Managers** handle session state, history, and events
- **Stateless Implementations** focus on single responsibilities (API calls, rendering, audio)
- **Event-Driven** architecture enables loose coupling between components
- **Security-First** design with client/server separation for API keys
- **Type-Safe** with full TypeScript support

For detailed architecture, see individual package documentation.

## 🔧 Creating Custom Components

Charivo's modular design allows you to create custom implementations for any component.

### Custom LLM Client

```typescript
import { LLMClient } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";

class MyLLMClient implements LLMClient {
  async call(messages: Array<{ role: string; content: string }>): Promise<string> {
    // Call your custom LLM API
    const response = await fetch("https://my-llm-api.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages })
    });
    const data = await response.json();
    return data.message;
  }
}

const llmManager = createLLMManager(new MyLLMClient());
```

### Custom TTS Player

```typescript
import { TTSPlayer, TTSOptions } from "@charivo/core";
import { createTTSManager } from "@charivo/tts-core";

class MyTTSPlayer implements TTSPlayer {
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // Generate and play audio from your TTS service
    const audio = new Audio(await this.generateAudioUrl(text));
    await audio.play();
  }

  async stop(): Promise<void> {
    // Stop playback
  }

  setVoice(voice: string): void {
    // Set voice
  }

  isSupported(): boolean {
    return true;
  }

  private async generateAudioUrl(text: string): Promise<string> {
    // Your TTS API call
    const response = await fetch("https://my-tts-api.com/synthesize", {
      method: "POST",
      body: JSON.stringify({ text })
    });
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }
}

const ttsManager = createTTSManager(new MyTTSPlayer());
```

### Custom STT Transcriber

```typescript
import { STTTranscriber, STTOptions } from "@charivo/core";
import { createSTTManager } from "@charivo/stt-core";

class MySTTTranscriber implements STTTranscriber {
  async transcribe(audio: Blob | ArrayBuffer, options?: STTOptions): Promise<string> {
    // Convert to Blob if needed
    const audioBlob = audio instanceof Blob 
      ? audio 
      : new Blob([audio], { type: "audio/webm" });

    // Send to your STT service
    const formData = new FormData();
    formData.append("audio", audioBlob);
    
    const response = await fetch("https://my-stt-api.com/transcribe", {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    return data.transcription;
  }
}

const sttManager = createSTTManager(new MySTTTranscriber());
```

**For detailed implementation guides, see:**
- [LLM packages](./packages/llm-core) - Custom LLM clients and providers
- [TTS packages](./packages/tts-core) - Custom TTS players and providers
- [STT packages](./packages/stt-core) - Custom STT transcribers and providers
- [Rendering packages](./packages/render-core) - Custom renderers

## 🎯 Core Concepts

### Component Types

| Type | Responsibility | Examples |
|------|----------------|----------|
| **Managers** | Session state, history, events | `LLMManager`, `TTSManager`, `STTManager` |
| **Clients/Players/Transcribers** | API calls, data processing | `RemoteLLMClient`, `WebTTSPlayer` |
| **Providers** | Server-side API integration | `OpenAILLMProvider`, `OpenAITTSProvider` |
| **Renderers** | Character visualization | `Live2DRenderer` |

### Recommended Setup

| Feature | Client-side (Browser) | Server-side (API Routes) |
|---------|----------------------|--------------------------|
| **LLM** | `@charivo/llm-client-remote` | `@charivo/llm-provider-openai` |
| **TTS** | `@charivo/tts-player-remote` or `tts-player-web` | `@charivo/tts-provider-openai` |
| **STT** | `@charivo/stt-transcriber-remote` | `@charivo/stt-provider-openai` |
| **Render** | `@charivo/render-live2d` | N/A |

> **💡 Tip**: Use `remote` packages on client + `provider` packages on server for production apps.

## 🎨 Live2D Setup

```typescript
import { createLive2DRenderer } from "@charivo/render-live2d";

const renderer = createLive2DRenderer({ canvas });
await renderer.initialize();
await renderer.loadModel("/live2d/model.model3.json");
```

**Features:**
- ✅ Automatic lip-sync with TTS
- ✅ Emotion-based expressions and motions
- ✅ Idle animations
- ✅ Physics simulation

**See [@charivo/render-live2d](./packages/render-live2d)** for detailed setup guide and model requirements.

## 🎭 Emotion System

Charivo's LLM can control character expressions and motions using emotion tags:

```typescript
// LLM generates: "Hello! [happy] Nice to meet you!"
// Result:
// - Text: "Hello! Nice to meet you!"
// - Expression: "smile"
// - Motion: "TapBody" animation
```

**Supported emotions:**
`happy`, `sad`, `angry`, `surprised`, `thinking`, `excited`, `shy`, `neutral`

**Setup:**
```typescript
charivo.setCharacter({
  id: "character",
  name: "Character",
  personality: "Friendly",
  emotionMappings: [
    {
      emotion: Emotion.HAPPY,
      expression: "smile",
      motion: { group: "TapBody", index: 0 }
    },
    // ... more emotions
  ]
});
```

**See [@charivo/llm-core](./packages/llm-core)** for complete emotion system documentation.

## 📚 API Reference

### Core API

```typescript
// Main orchestrator
const charivo = new Charivo();

// Attach components
charivo.attachLLM(llmManager);
charivo.attachTTS(ttsManager);
charivo.attachSTT(sttManager);
charivo.attachRenderer(renderManager);

// Set character
charivo.setCharacter(character);

// User interaction
await charivo.userSay("Hello!");

// Events
charivo.on("message:sent", (data) => {});
charivo.on("message:received", (data) => {});
charivo.on("character:speak", (data) => {});
```

**For detailed API documentation, see:**
- [@charivo/core](./packages/core) - Core API and types
- [@charivo/llm-core](./packages/llm-core) - LLM Manager API
- [@charivo/tts-core](./packages/tts-core) - TTS Manager API
- [@charivo/stt-core](./packages/stt-core) - STT Manager API
- [@charivo/render-core](./packages/render-core) - Render Manager API

## 🤝 Contributing

We welcome contributions!

### Quick Start

```bash
# Fork and clone
git clone https://github.com/zeikar/charivo.git
cd charivo

# Install dependencies
pnpm install

# Set up pre-commit hooks
pnpm setup:hooks

# Build packages
pnpm build

# Run tests
pnpm test

# Run demo
cd examples/web && pnpm dev
```

### Guidelines

- **Code Quality**: ESLint, Prettier, TypeScript checks run automatically
- **Tests**: Add tests for new features
- **Documentation**: Update README for public APIs
- **Commits**: Use clear, descriptive commit messages

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Live2D](https://www.live2d.com/) for the amazing 2D animation technology
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) for the Live2D integration
- [OpenAI](https://openai.com/) for GPT API
- All contributors and the open source community

---

<div align="center">

**[🌟 Star this repo](https://github.com/zeikar/charivo)** • **[📖 Documentation](https://github.com/zeikar/charivo/wiki)** • **[🐛 Report Bug](https://github.com/zeikar/charivo/issues)** • **[💡 Request Feature](https://github.com/zeikar/charivo/issues)**

Made with ❤️ by [zeikar](https://github.com/zeikar)

</div>
