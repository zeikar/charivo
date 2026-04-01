# @charivo/tts-player-openai

Direct OpenAI browser TTS player for Charivo.

Use this only for local development or trusted environments. It wraps the
OpenAI provider with `dangerouslyAllowBrowser: true`.

For production browser apps, prefer `@charivo/tts-player-remote`.

## Install

```bash
pnpm add @charivo/tts-player-openai
```

## Usage

```ts
import { createOpenAITTSPlayer } from "@charivo/tts-player-openai";

const player = createOpenAITTSPlayer({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
  defaultVoice: "marin",
  defaultModel: "gpt-4o-mini-tts",
});
```

## Config

- `apiKey`
- `defaultVoice?` default: `marin`
- `defaultModel?` default: `gpt-4o-mini-tts`
