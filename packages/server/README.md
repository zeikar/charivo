# @charivo/server

Server-side provider adapters for Charivo. Use these behind your own API routes
so vendor credentials stay on the server.

## Install

```bash
pnpm add @charivo/server
```

## Usage

Imports are subpath-only — there is no root export.

### OpenAI providers

```ts
import {
  createOpenAILLMProvider,
  createOpenAITTSProvider,
  createOpenAISTTProvider,
  createOpenAIRealtimeProvider,
} from "@charivo/server/openai";

const llm = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});
```

### OpenClaw providers

```ts
import { createOpenClawLLMProvider } from "@charivo/server/openclaw";

const llm = createOpenClawLLMProvider({
  token: process.env.OPENCLAW_TOKEN!,
  baseUrl: process.env.OPENCLAW_BASE_URL!,
  agentId: process.env.OPENCLAW_AGENT_ID!,
});
```

## Exports

- `@charivo/server/openai`: `createOpenAILLMProvider`, `createOpenAITTSProvider`, `createOpenAISTTProvider`, `createOpenAIRealtimeProvider`
- `@charivo/server/openclaw`: `createOpenClawLLMProvider`
