# @charivo/llm-client-openai

Direct OpenAI browser LLM client for Charivo.

Use this only for local development and testing. It enables browser-side access
by passing `dangerouslyAllowBrowser: true` to the underlying provider.

For production, prefer `@charivo/llm-client-remote`.

## Install

```bash
pnpm add @charivo/llm-client-openai
```

## Usage

```ts
import { createOpenAILLMClient } from "@charivo/llm-client-openai";

const client = createOpenAILLMClient({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});

const message = await client.call([
  { role: "user", content: "Hello" },
]);
```

## Config

The client reuses `OpenAILLMConfig` from `@charivo/llm-provider-openai`:

- `apiKey`
- `model?`
- `temperature?`
- `maxTokens?`
