# @charivo/tts-provider-openai

Server-side OpenAI TTS provider for Charivo.

## Install

```bash
pnpm add @charivo/tts-provider-openai
```

## Usage

```ts
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultVoice: "marin",
  defaultModel: "gpt-4o-mini-tts",
});

const audio = await provider.generateSpeech("Hello", {
  voice: "marin",
  rate: 1,
});
```

## Config

- `apiKey`
- `defaultVoice?` default: `marin`
- `defaultModel?` default: `gpt-4o-mini-tts`
- `dangerouslyAllowBrowser?` testing only
