# @charivo/llm-provider-openclaw

Server-side LLM provider for [Charivo](https://github.com/zeikar/charivo) that connects to [OpenClaw](https://openclaw.ai) using its OpenAI-compatible HTTP API.

## Features

- OpenAI SDK compatibility via custom `baseURL`
- `x-openclaw-agent-id` header support for agent routing
- Configurable base URL, model, temperature, and max tokens
- Server-side only by default (set `dangerouslyAllowBrowser` for testing)

## Installation

```bash
npm install @charivo/llm-provider-openclaw
```

## Usage

### Basic (Server-side)

```typescript
import { createOpenClawLLMProvider } from "@charivo/llm-provider-openclaw";

const provider = createOpenClawLLMProvider({
  token: process.env.OPENCLAW_TOKEN!,
  baseURL: process.env.OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789/v1",
  agentId: process.env.OPENCLAW_AGENT_ID ?? "main",
});

const response = await provider.generateResponse([
  { role: "user", content: "Hello!" },
]);
console.log(response);
```

### Next.js API Route (Recommended)

Use this package server-side to avoid exposing your token to the browser.

```typescript
// app/api/chat-openclaw/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createOpenClawLLMProvider } from "@charivo/llm-provider-openclaw";

const provider = createOpenClawLLMProvider({
  token: process.env.OPENCLAW_TOKEN ?? "",
  baseURL: process.env.OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789/v1",
  agentId: process.env.OPENCLAW_AGENT_ID ?? "main",
});

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const response = await provider.generateResponse(messages);
  return NextResponse.json({ response });
}
```

### Express

```typescript
import express from "express";
import { createOpenClawLLMProvider } from "@charivo/llm-provider-openclaw";

const provider = createOpenClawLLMProvider({
  token: process.env.OPENCLAW_TOKEN!,
});

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  const response = await provider.generateResponse(messages);
  res.json({ response });
});
```

## API Reference

### `createOpenClawLLMProvider(config)`

Factory function that creates an `OpenClawLLMProvider` instance.

### `OpenClawLLMProvider`

Implements the `LLMProvider` interface from `@charivo/core`.

#### Methods

- `generateResponse(messages: Array<{ role: string; content: string }>): Promise<string>`

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | required | OpenClaw API token |
| `baseURL` | `string` | `"http://127.0.0.1:18789/v1"` | OpenClaw server base URL |
| `agentId` | `string` | `"main"` | OpenClaw agent ID (sent as `x-openclaw-agent-id` header) |
| `model` | `string` | `"openclaw"` | Model name |
| `temperature` | `number` | `0.7` | Sampling temperature |
| `maxTokens` | `number` | `1000` | Maximum tokens in response |
| `dangerouslyAllowBrowser` | `boolean` | `false` | Allow use in browser (exposes token — testing only) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCLAW_TOKEN` | OpenClaw API token |
| `OPENCLAW_BASE_URL` | OpenClaw server base URL (default: `http://127.0.0.1:18789/v1`) |
| `OPENCLAW_AGENT_ID` | OpenClaw agent ID (default: `main`) |

## Related Packages

- [`@charivo/llm-client-openclaw`](../llm-client-openclaw) — Browser-side OpenClaw client (wraps this provider)
- [`@charivo/llm-client-remote`](../llm-client-remote) — HTTP proxy client (recommended for browser use)
- [`@charivo/core`](../core) — Core interfaces

## See Also

- [OpenClaw OpenAI-compatible HTTP API](https://docs.openclaw.ai/gateway/openai-http-api)

## License

MIT
