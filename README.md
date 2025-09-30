# 🧩✨ Charivo

**A modular Live2D + LLM framework for interactive character experiences**

Charivo lets you create interactive AI characters with Live2D animations, voice synthesis, and natural language conversations. Mix and match components like LEGO blocks - swap LLM providers, renderers, TTS engines, and more with ease! ✨

## ✨ Features

- 🧩 **Live2D Integration** - Bring characters to life with smooth 2D animations
- 🤖 **LLM Support** - Connect to OpenAI or implement custom LLM adapters
- 🔊 **Text-to-Speech** - Multiple TTS options: Web Speech API, OpenAI TTS
- 💋 **Lip-Sync Animation** - Automatic mouth movement synchronized with speech audio
- 📦 **Modular Architecture** - Plugin-based system for easy extensibility
- ⚡ **TypeScript First** - Full type safety and IntelliSense support
- 🎨 **Framework Agnostic** - Use with React, Vue, or vanilla JavaScript

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/zeikar/charivo.git
cd charivo

# Install dependencies
pnpm install

# Build packages
pnpm build

# Set up pre-commit hooks (recommended for contributors)
pnpm setup:hooks

# Run the demo
cd examples/web
pnpm dev
```

### Basic Usage

```typescript
import { Charivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";
// or
// import { createWebTTSPlayer } from "@charivo/tts-player-web"; // Browser Speech API
import { Live2DRenderer } from "@charivo/render-live2d";

// Create Charivo instance
const charivo = new Charivo();

// Set up LLM (new architecture)
const llmClient = createRemoteLLMClient({ apiEndpoint: "/api/chat" });
const llmManager = createLLMManager(llmClient);

// Set up TTS
const ttsPlayer = createRemoteTTSPlayer({ apiEndpoint: "/api/tts" });

// Set up renderer
const renderer = new Live2DRenderer(canvasElement);

// Connect components
charivo.attachLLM(llmManager);
charivo.attachTTS(ttsPlayer);
charivo.attachRenderer(renderer);

// Add your character
charivo.addCharacter({
  id: "hiyori",
  name: "Hiyori",
  description: "Friendly AI assistant",
  personality: "Cheerful and helpful AI assistant",
  voice: {
    rate: 1.0,
    pitch: 1.2,
    volume: 0.8
  }
});

// Start chatting!
await charivo.userSay("Hello!", "hiyori");
```

## 📦 Packages

### Core Packages
| Package | Description |
|---------|-------------|
| [`@charivo/core`](./packages/core) | Core framework with event system and character management |
| [`@charivo/shared`](./packages/shared) | Shared utilities and types |

### LLM (Language Model) Packages
| Package | Description |
|---------|-------------|
| [`@charivo/llm-core`](./packages/llm-core) | Core utilities and helpers for LLM functionality |
| [`@charivo/llm-client-openai`](./packages/llm-client-openai) | OpenAI LLM client (local/testing) |
| [`@charivo/llm-client-remote`](./packages/llm-client-remote) | Remote HTTP LLM client (client-side) |
| [`@charivo/llm-client-stub`](./packages/llm-client-stub) | Stub LLM client for testing |
| [`@charivo/llm-provider-openai`](./packages/llm-provider-openai) | OpenAI LLM provider (server-side) |

### TTS (Text-to-Speech) Packages
| Package | Description |
|---------|-------------|
| [`@charivo/tts-core`](./packages/tts-core) | Core TTS functionality with audio processing and lip-sync integration |
| [`@charivo/tts-player-web`](./packages/tts-player-web) | Web Speech API TTS player |
| [`@charivo/tts-player-remote`](./packages/tts-player-remote) | Remote HTTP TTS player (client-side) |
| [`@charivo/tts-player-openai`](./packages/tts-player-openai) | OpenAI TTS player |
| [`@charivo/tts-provider-openai`](./packages/tts-provider-openai) | OpenAI TTS provider (server-side) |

### Rendering Packages
| Package | Description |
|---------|-------------|
| [`@charivo/render-live2d`](./packages/render-live2d) | Live2D character rendering |
| [`@charivo/render-stub`](./packages/render-stub) | Stub renderer for testing |

## 🎯 Examples

### Web Demo
A complete Next.js application showcasing all features using the new modular architecture:
- Live2D character animation with `@charivo/render-live2d`
- LLM conversation with `@charivo/llm-core` + client/provider separation
- Text-to-speech with `@charivo/tts-core` + player/provider architecture
- Real-time lip-sync animation synchronized with speech audio
- Interactive chat interface

```bash
cd examples/web
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the demo.

The example demonstrates:
- **Client-side**: Using remote LLM/TTS clients for secure API access
- **Server-side**: API routes with OpenAI providers
- **Modular design**: Easy switching between different implementations

## 🏗️ Architecture

Charivo follows a modular, layered architecture with clear separation of concerns:

```
┌─────────────────────────────┐
│        Your App             │  ←─ Next.js, React, Vue, etc.
├─────────────────────────────┤
│      @charivo/core          │  ←─ Event bus, character management
├─────────────────────────────┤
│  ┌─────────────────────────┐│
│  │    LLM Layer            ││  
│  │ ┌─────────┬───────────┐ ││
│  │ │LLM-Core │ Clients   │ ││  ←─ Remote, OpenAI, Stub
│  │ └─────────┴───────────┘ ││
│  └─────────────────────────┘│
│  ┌─────────────────────────┐│
│  │    TTS Layer            ││
│  │ ┌─────────┬───────────┐ ││
│  │ │TTS-Core │ Players   │ ││  ←─ Web, Remote, OpenAI
│  │ └─────────┴───────────┘ ││
│  └─────────────────────────┘│
│  ┌─────────────────────────┐│
│  │   Rendering Layer       ││  ←─ Live2D, Stub, custom...
│  └─────────────────────────┘│
├─────────────────────────────┤
│   Server-Side Providers     │  ←─ OpenAI API, Custom APIs
└─────────────────────────────┘
```

### New Architecture Benefits

- **Client/Server Separation**: Clear distinction between client-side players and server-side providers
- **Stateful Management**: Core managers handle session state, history, and character context
- **Pluggable Components**: Easy to swap between different implementations (Web Speech → OpenAI TTS)
- **Type Safety**: Full TypeScript support across all layers

## 🔧 Creating Custom Components

### LLM Client
```typescript
import { LLMClient, Message } from "@charivo/llm-core";

class CustomLLMClient implements LLMClient {
  async generateResponse(messages: Message[]): Promise<string> {
    // Your custom LLM API logic here
    return "Custom response";
  }
}

// Use with LLM Manager
import { createLLMManager } from "@charivo/llm-core";
const llmManager = createLLMManager(new CustomLLMClient());
```

### TTS Components

Charivo provides multiple TTS (Text-to-Speech) options with clear client/server separation:

#### Web Speech API (Browser-native)
```typescript
import { createWebTTSPlayer } from "@charivo/tts-player-web";

// Uses browser's built-in speech synthesis - no server required
const webTTSPlayer = createWebTTSPlayer();
```

#### Remote TTS (Server-powered, Client-safe)
```typescript
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";

// Client-side player that calls your server API
// Requires server-side implementation (see /api/tts route)
const remoteTTSPlayer = createRemoteTTSPlayer({
  apiEndpoint: "/api/tts", // Your server endpoint
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd"
});
```

**⚠️ Important**: The Remote TTS player is a **client-side HTTP player** that calls your server API. This design keeps API keys secure on the server side. You need to implement a server endpoint like `/api/tts` that handles the actual TTS API calls.

#### OpenAI TTS (Server-side only)
```typescript
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

// Server-side provider that directly calls OpenAI API
// ⚠️ Only use in Node.js/server environments
const openaiTTSProvider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!, // Server-side only!
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd"
});

// Generate audio data (server-side)
const audioBuffer = await openaiTTSProvider.generateSpeech("Hello world!");
```

**🔐 Security Note**: This provider directly calls OpenAI API and should only be used in server environments. For client-side usage, use the Remote TTS player above.

#### Custom TTS Player
```typescript
import { TTSPlayer, TTSOptions } from "@charivo/tts-core";

class CustomTTSPlayer implements TTSPlayer {
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // Your custom TTS implementation
  }

  // Implement other required methods...
}
```

## 🎯 Core Concepts

### Component Types

#### **Managers** (Stateful)
- Handle conversation history and character context
- Manage session state and user interactions
- Examples: `LLMManager` from `@charivo/llm-core`

#### **Clients & Players** (Stateless) 
- Focus on API communication and data processing
- No session state - pure input/output functions
- Examples: `RemoteLLMClient`, `WebTTSPlayer`

#### **Providers** (Server-side)
- Handle direct API integration with external services
- Manage API keys and authentication securely
- Examples: `OpenAILLMProvider`, `OpenAITTSProvider`

### Implementation Options

| Component | Available Types | Use Case |
|-----------|----------------|----------|
| **LLM** | `remote`, `openai`, `stub` | Client-side conversation |
| | `openai-provider` | Server-side API integration |
| **TTS** | `web`, `remote`, `openai` | Client-side audio playback |
| | `openai-provider` | Server-side audio generation |
| **Rendering** | `live2d`, `stub` | Character visualization |

## 🎨 Live2D Setup

1. **Get a Live2D model** (`.model3.json` and assets)
2. **Place in your public directory**
3. **Load the model**:

```typescript
await renderer.loadModel("/path/to/your/model.model3.json");
```

### Lip-Sync Features

Charivo automatically provides lip-sync animation when TTS is active:

- **Audio Analysis**: Analyzes speech audio in real-time for mouth movement timing
- **Parameter Control**: Controls Live2D mouth parameters (`ParamMouthOpenY`) based on audio volume
- **Smooth Animation**: Provides natural-looking mouth movements synchronized with speech
- **Automatic Integration**: Works out-of-the-box with any TTS player (Web Speech, OpenAI TTS, etc.)

```typescript
// Lip-sync happens automatically when character speaks
await charivo.userSay("Hello! Watch my mouth move!", "hiyori");
// Character will speak with synchronized lip movement
```

The demo includes a free Hiyori model from Live2D samples with lip-sync support.

## 📚 API Reference

### Core Classes

#### `Charivo`
Main orchestrator class that manages all components.

**Methods:**
- `attachLLM(manager: LLMManager)` - Connect LLM manager
- `attachTTS(player: TTSPlayer)` - Connect TTS player
- `attachRenderer(renderer: Renderer)` - Connect renderer
- `addCharacter(character: Character)` - Add character
- `userSay(message: string, characterId?: string)` - Send user message
- `getHistory()` - Get conversation history
- `clearHistory()` - Clear conversation history
- `getCurrentCharacter()` - Get current active character
- `on(event: string, callback: Function)` - Listen to events

#### `LLMManager` (from `@charivo/llm-core`)
Manages LLM state and conversation flow.

**Methods:**
- `generateResponse(message: string)` - Generate AI response
- `setCharacter(character: Character)` - Set character context
- `getHistory()` - Get conversation history  
- `clearHistory()` - Reset conversation history

#### `TTSPlayer` (from `@charivo/tts-core`)
Base interface for TTS players.

**Methods:**
- `speak(text: string, options?: TTSOptions)` - Play text as speech
- `stop()` - Stop current speech
- `pause()` - Pause speech
- `resume()` - Resume paused speech

#### Events
- `message:sent` - User sent a message
- `message:received` - Character responded
- `character:speak` - Character is speaking
- `tts:start` - TTS started
- `tts:end` - TTS finished
- `tts:error` - TTS error occurred

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/charivo.git
   cd charivo
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Set up pre-commit hooks:
   ```bash
   pnpm setup:hooks
   ```
   This installs Git hooks that automatically run linting and formatting checks before each commit.

5. Create your feature branch (`git checkout -b feature/amazing-feature`)
6. Make your changes and commit (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Code Quality

This project uses pre-commit hooks to maintain code quality:
- **ESLint** for code linting
- **Prettier** for code formatting  
- **TypeScript** for type checking

The hooks run automatically before each commit. If you need to bypass them (not recommended):
```bash
git commit --no-verify -m "your message"
```

### Testing

Run the unit test suite (powered by [Vitest](https://vitest.dev/)) across every package:

```bash
pnpm test
```

For an interactive watch mode during development:

```bash
pnpm test:watch
```

The configuration lives in `vitest.config.ts` with shared setup in `vitest.setup.ts`, and tests reside beside each package under `packages/*/__tests__`.

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
