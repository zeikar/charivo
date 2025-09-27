# 🧩✨ Charivo

**A modular Live2D + LLM framework for interactive character experiences**

Charivo lets you create interactive AI characters with Live2D animations, voice synthesis, and natural language conversations. Mix and match components like LEGO blocks - swap LLM providers, renderers, TTS engines, and more with ease! ✨

## ✨ Features

- 🧩 **Live2D Integration** - Bring characters to life with smooth 2D animations
- 🤖 **LLM Support** - Connect to OpenAI or implement custom LLM adapters
- 🔊 **Text-to-Speech** - Multiple TTS options: Web Speech API, OpenAI TTS
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
import { createOpenAIAdapter } from "@charivo/adapter-llm-openai";
import { createRemoteTTSAdapter } from "@charivo/adapter-tts-remote"; // Client-side HTTP adapter
// or
// import { createWebTTSAdapter } from "@charivo/adapter-tts-web"; // Browser Speech API
import { Live2DRenderer } from "@charivo/render-live2d";

// Create Charivo instance
const charivo = new Charivo();

// Set up components
const llmAdapter = createOpenAIAdapter("/api/chat");
const ttsAdapter = createRemoteTTSAdapter({ apiEndpoint: "/api/tts" }); // Calls server API
const renderer = new Live2DRenderer(canvasElement);

// Connect adapters
charivo.attachLLM(llmAdapter);
charivo.attachTTS(ttsAdapter);
charivo.attachRenderer(renderer);

// Add your character
charivo.addCharacter({
  id: "hiyori",
  name: "Hiyori",
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

| Package | Description |
|---------|-------------|
| [`@charivo/core`](./packages/core) | Core framework with event system and character management |
| [`@charivo/adapter-llm-openai`](./packages/adapter-llm-openai) | OpenAI GPT integration |
| [`@charivo/adapter-llm-stub`](./packages/adapter-llm-stub) | Stub adapter for testing |
| [`@charivo/adapter-tts-web`](./packages/adapter-tts-web) | Web Speech API TTS integration |
| [`@charivo/adapter-tts-remote`](./packages/adapter-tts-remote) | Remote HTTP TTS adapter (client-side) |
| [`@charivo/adapter-tts-openai`](./packages/adapter-tts-openai) | OpenAI TTS integration (server-side) |
| [`@charivo/render-live2d`](./packages/render-live2d) | Live2D character rendering |
| [`@charivo/render-stub`](./packages/render-stub) | Stub renderer for testing |
| [`@charivo/shared`](./packages/shared) | Shared utilities and types |

## 🎯 Examples

### Web Demo
A complete Next.js application showcasing all features:
- Live2D character animation
- OpenAI GPT conversation
- Text-to-speech output
- Interactive chat interface

```bash
cd examples/web
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the demo.

## 🏗️ Architecture

Charivo follows a modular, adapter-based architecture:

```
┌─────────────────┐
│   Your App      │
├─────────────────┤
│ @charivo/core   │  ←─ Event bus, character management
├─────────────────┤
│   Adapters      │  ←─ Pluggable components
│  ┌───────────┐  │
│  │    LLM    │  │  ←─ OpenAI, Claude, local models...
│  ├───────────┤  │
│  │ Renderer  │  │  ←─ Live2D, 3D, sprite-based...
│  ├───────────┤  │
│  │    TTS    │  │  ←─ Web Speech, Azure, ElevenLabs...
│  └───────────┘  │
└─────────────────┘
```

## 🔧 Creating Custom Adapters

### LLM Adapter
```typescript
import { LLMAdapter, Message, Character } from "@charivo/core";

class CustomLLMAdapter implements LLMAdapter {
  async generateResponse(message: Message): Promise<string> {
    // Your custom LLM logic here
    return "Custom response";
  }

  setCharacter(character: Character): void {
    // Configure your LLM with character context
  }

  clearHistory(): void {
    // Reset conversation history
  }
}
```

### TTS Adapter

Charivo provides multiple TTS (Text-to-Speech) options:

#### Web Speech API (Browser-native)
```typescript
import { TTSAdapter, TTSOptions } from "@charivo/core";
import { createWebTTSAdapter } from "@charivo/adapter-tts-web";

// Uses browser's built-in speech synthesis
const webTTSAdapter = createWebTTSAdapter();
```

#### Remote TTS (Server-powered, Client-safe)
```typescript
import { createRemoteTTSAdapter } from "@charivo/adapter-tts-remote";

// Client-side adapter that calls your server API
// Requires server-side implementation (see /api/tts route)
const remoteTTSAdapter = createRemoteTTSAdapter({
  apiEndpoint: "/api/tts", // Your server endpoint
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd"
});
```

**⚠️ Important**: The Remote TTS adapter is a **client-side HTTP adapter** that calls your server API. This design keeps API keys secure on the server side. You need to implement a server endpoint like `/api/tts` that handles the actual TTS API calls.

#### OpenAI TTS (Server-side only)
```typescript
import { createOpenAITTSAdapter } from "@charivo/adapter-tts-openai";

// Server-side adapter that directly calls OpenAI API
// ⚠️ Only use in Node.js/server environments
const openaiTTSAdapter = createOpenAITTSAdapter({
  apiKey: process.env.OPENAI_API_KEY!, // Server-side only!
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd"
});

// Generate audio data (server-side)
const audioBuffer = await openaiTTSAdapter.generateSpeech("Hello world!");
```

**🔐 Security Note**: This adapter directly calls OpenAI API and should only be used in server environments. For client-side usage, use the Remote TTS adapter above.

#### Custom TTS Adapter
```typescript
import { TTSAdapter, TTSOptions } from "@charivo/core";

class CustomTTSAdapter implements TTSAdapter {
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // Your custom TTS implementation
  }

  // Implement other required methods...
}
```

## 🎨 Live2D Setup

1. **Get a Live2D model** (`.model3.json` and assets)
2. **Place in your public directory**
3. **Load the model**:

```typescript
await renderer.loadModel("/path/to/your/model.model3.json");
```

The demo includes a free Hiyori model from Live2D samples.

## 📚 API Reference

### Core Classes

#### `Charivo`
Main orchestrator class that manages all components.

**Methods:**
- `attachLLM(adapter: LLMAdapter)` - Connect LLM provider
- `attachTTS(adapter: TTSAdapter)` - Connect TTS provider  
- `attachRenderer(renderer: Renderer)` - Connect renderer
- `addCharacter(character: Character)` - Add character
- `userSay(message: string, characterId?: string)` - Send user message
- `on(event: string, callback: Function)` - Listen to events

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
