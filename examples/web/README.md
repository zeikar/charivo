# 🧩✨ Charivo Web Demo

A complete Next.js application showcasing the Charivo framework with Live2D character integration, AI conversations, and flexible TTS support.

## ✨ Features

- 🎎 **Live2D Character**: Hiyori character with real-time animations
- 🤖 **AI Conversations**: OpenAI GPT-powered responses
- 🔊 **Flexible TTS**: Multiple TTS providers with easy switching
- 💬 **Interactive Chat**: Real-time chat interface
- 📱 **Responsive Design**: Works on desktop and mobile

## 🚀 Getting Started

### 1. Environment Setup

Copy the environment template:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your API keys:
```env
# Required: OpenAI API key for chat and TTS
OPENAI_API_KEY=your_openai_api_key_here

# Optional: TTS Provider selection
TTS_PROVIDER=openai
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build Required Packages

```bash
# From the root of the repository
pnpm build
```

### 4. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the demo.

## 🔧 Configuration

### TTS Provider Configuration

The demo supports flexible TTS provider switching via environment variables:

#### OpenAI TTS (Default)
```env
TTS_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
```

#### Adding Custom TTS Providers

You can extend the TTS system by modifying `/app/api/tts/route.ts`:

```typescript
const ttsProviders = {
  // ... existing providers
  
  async elevenlabs(text: string, options: any) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${options.voice}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY!
      },
      body: JSON.stringify({ text })
    });
    return await response.arrayBuffer();
  }
};
```

### TTS API Endpoints

#### POST `/api/tts` - Generate Speech
Generate speech from text using the configured TTS provider.

**Request:**
```json
{
  "text": "Hello world!",
  "voice": "alloy",
  "model": "tts-1-hd",
  "speed": 1.0,
  "format": "mp3",
  "provider": "openai"
}
```

**Response:** Audio data (binary)

#### GET `/api/tts` - Provider Information
Get information about available TTS providers and their configurations.

**Response:**
```json
{
  "currentProvider": "openai",
  "availableProviders": ["openai"],
  "providerInfo": {
    "openai": {
      "name": "OpenAI TTS",
      "voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
      "models": ["tts-1", "tts-1-hd"],
      "formats": ["mp3", "opus", "aac", "flac"]
    }
  }
}
```

## 🏗️ Architecture

```
Frontend (React/Next.js)
├── @charivo/core                 # Core framework
├── @charivo/adapter-llm-openai   # LLM integration  
├── @charivo/adapter-tts-remote   # Client-side TTS adapter
├── @charivo/render-live2d        # Live2D rendering
└── Backend API Routes
    ├── /api/chat                 # OpenAI GPT chat
    └── /api/tts                  # Flexible TTS providers
        └── @charivo/adapter-tts-openai  # Server-side TTS
```

## 🎮 Usage Examples

### Basic Chat
1. Type a message in the chat input
2. Hiyori will respond with AI-generated text
3. Response is automatically converted to speech
4. Live2D character animations react to interactions

### Voice Customization
The demo supports different OpenAI voices:
- **Alloy**: Neutral, balanced
- **Echo**: Clear, expressive  
- **Fable**: Warm, engaging
- **Onyx**: Deep, authoritative
- **Nova**: Bright, energetic
- **Shimmer**: Gentle, soothing

## 📁 Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts         # LLM chat endpoint
│   │   └── tts/route.ts          # TTS generation endpoint
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx                  # Main demo page
│   └── manifest.json
├── live2d/                       # Live2D model assets
└── public/
```

## 🔧 Development

### Adding New TTS Providers

1. **Add provider configuration** in `/app/api/tts/route.ts`
2. **Implement provider function** in `ttsProviders` object
3. **Add environment variables** in `.env.example`
4. **Update provider info** in GET endpoint

### Customizing the Character

- **Model**: Replace Live2D model in `/public/live2d/`
- **Personality**: Modify character definition in `page.tsx`
- **Voice**: Change default voice settings

## 🚀 Deployment

### Vercel (Recommended)

1. Connect your repository to Vercel
2. Add environment variables in Vercel dashboard
3. Deploy automatically on git push

### Environment Variables for Production

```env
OPENAI_API_KEY=your_production_api_key
TTS_PROVIDER=openai
```

## 📚 Learn More

- [Charivo Documentation](../../README.md)
- [Next.js Documentation](https://nextjs.org/docs)
- [Live2D Documentation](https://docs.live2d.com/)
- [OpenAI API Documentation](https://platform.openai.com/docs)

## 🤝 Contributing

This is part of the Charivo framework. See the main repository for contribution guidelines.

---

Built with ❤️ using Charivo Framework
