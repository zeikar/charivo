# @charivo/stt-transcriber-openai

Direct OpenAI browser STT transcriber for Charivo.

Use this only for local development or trusted environments. It records audio
in the browser and sends it directly to OpenAI through the provider wrapper.

For production browser apps, prefer `@charivo/stt-transcriber-remote`.

## Install

```bash
pnpm add @charivo/stt-transcriber-openai
```

## Usage

```ts
import { createOpenAISTTTranscriber } from "@charivo/stt-transcriber-openai";

const transcriber = createOpenAISTTTranscriber({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
  defaultModel: "whisper-1",
});
```

## Config

- `apiKey`
- `defaultModel?` default: `whisper-1`
- `defaultLanguage?`
