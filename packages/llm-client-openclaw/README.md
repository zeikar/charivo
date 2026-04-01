# @charivo/llm-client-openclaw

Direct OpenClaw browser LLM client for Charivo.

Use this for local development, experiments, or when you explicitly accept
browser-to-OpenClaw traffic. For production browser apps, prefer a server route
plus `@charivo/llm-client-remote`.

## Install

```bash
pnpm add @charivo/llm-client-openclaw
```

## Usage

```ts
import { createOpenClawLLMClient } from "@charivo/llm-client-openclaw";

const client = createOpenClawLLMClient({
  token: "your-token",
  baseURL: "http://127.0.0.1:18789/v1",
  agentId: "main",
});

const message = await client.call([
  { role: "user", content: "Hello" },
]);
```

## Config

The client reuses `OpenClawLLMConfig` from `@charivo/llm-provider-openclaw`:

- `token`
- `baseURL?`
- `agentId?`
- `model?`
- `temperature?`
- `maxTokens?`
