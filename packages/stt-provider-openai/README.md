# @charivo/stt-provider-openai

Server-side OpenAI STT provider for Charivo.

## Install

```bash
pnpm add @charivo/stt-provider-openai
```

## Usage

```ts
import { createOpenAISTTProvider } from "@charivo/stt-provider-openai";

const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: "whisper-1",
});

const text = await provider.transcribe(audioBlob, {
  language: "ko",
});
```

## Config

- `apiKey`
- `defaultModel?` default: `whisper-1`
- `defaultLanguage?`
- `dangerouslyAllowBrowser?` testing only
