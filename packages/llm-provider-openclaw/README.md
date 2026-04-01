# @charivo/llm-provider-openclaw

Server-side OpenClaw provider for Charivo.

This provider uses OpenClaw's OpenAI-compatible HTTP API. In browser apps, put
it behind your own server route and call that route from `@charivo/llm-client-remote`.

## Install

```bash
pnpm add @charivo/llm-provider-openclaw
```

## Usage

```ts
import { createOpenClawLLMProvider } from "@charivo/llm-provider-openclaw";

const provider = createOpenClawLLMProvider({
  token: process.env.OPENCLAW_TOKEN!,
  baseURL: process.env.OPENCLAW_BASE_URL,
  agentId: process.env.OPENCLAW_AGENT_ID,
});

const message = await provider.generateResponse([
  { role: "user", content: "Hello" },
]);
```

## Config

- `token`
- `baseURL?` default: `http://127.0.0.1:18789/v1`
- `agentId?` default: `main`
- `model?` default: `openclaw`
- `temperature?` default: `0.7`
- `maxTokens?` default: `1000`
- `dangerouslyAllowBrowser?` testing only
