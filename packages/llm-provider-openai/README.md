# @charivo/llm-provider-openai

Server-side OpenAI LLM provider for Charivo.

This package owns the actual OpenAI API call. In browser apps, pair it with a
server route and consume that route through `@charivo/llm-client-remote`.

## Install

```bash
pnpm add @charivo/llm-provider-openai
```

## Usage

```ts
import { createOpenAILLMProvider } from "@charivo/llm-provider-openai";

const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});

const message = await provider.generateResponse([
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hello" },
]);
```

## Config

- `apiKey`
- `model?` default: `gpt-4.1-nano`
- `temperature?` default: `0.7`
- `maxTokens?` default: `1000`
- `dangerouslyAllowBrowser?` testing only
