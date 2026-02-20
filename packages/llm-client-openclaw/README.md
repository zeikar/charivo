# @charivo/llm-client-openclaw

Browser-side LLM client for [Charivo](https://github.com/zeikar/charivo) that connects directly to a local [OpenClaw](https://openclaw.ai) server.

> **Note:** Direct browser connections to OpenClaw may encounter CORS issues depending on your server configuration. For production use, prefer [`@charivo/llm-client-remote`](../llm-client-remote) pointing to a server-side proxy that uses [`@charivo/llm-provider-openclaw`](../llm-provider-openclaw).

## Features

- Stateless design — session management is handled externally
- Wraps `@charivo/llm-provider-openclaw` with `dangerouslyAllowBrowser` enabled automatically
- Configurable base URL, agent ID, model, temperature, and max tokens

## Installation

```bash
npm install @charivo/llm-client-openclaw
```

## Usage

### Basic

```typescript
import { createOpenClawLLMClient } from "@charivo/llm-client-openclaw";

const client = createOpenClawLLMClient({
  token: "your-openclaw-token",
  baseURL: "http://127.0.0.1:18789/v1",
  agentId: "main",
});

const response = await client.call([
  { role: "user", content: "Hello!" },
]);
console.log(response);
```

### With Charivo LLMManager

```typescript
import { LLMManager } from "@charivo/llm-core";
import { createOpenClawLLMClient } from "@charivo/llm-client-openclaw";

const client = createOpenClawLLMClient({ token: "your-token" });
const manager = new LLMManager({ client });

const response = await manager.chat("Hello!");
```

### Recommended: Server-side Proxy (CORS-safe)

To avoid CORS issues, use [`@charivo/llm-client-remote`](../llm-client-remote) with a Next.js/Express route backed by [`@charivo/llm-provider-openclaw`](../llm-provider-openclaw):

```typescript
// Browser
import { createRemoteLLMClient } from "@charivo/llm-client-remote";
const client = createRemoteLLMClient({ apiEndpoint: "/api/chat-openclaw" });

// Server (app/api/chat-openclaw/route.ts)
import { createOpenClawLLMProvider } from "@charivo/llm-provider-openclaw";
const provider = createOpenClawLLMProvider({ token: process.env.OPENCLAW_TOKEN! });
```

## API Reference

### `createOpenClawLLMClient(config)`

Factory function that creates an `OpenClawLLMClient` instance.

### `OpenClawLLMClient`

Implements the `LLMClient` interface from `@charivo/core`.

#### Methods

- `call(messages: Array<{ role: string; content: string }>): Promise<string>`

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | required | OpenClaw API token |
| `baseURL` | `string` | `"http://127.0.0.1:18789/v1"` | OpenClaw server base URL |
| `agentId` | `string` | `"main"` | OpenClaw agent ID |
| `model` | `string` | `"openclaw"` | Model name |
| `temperature` | `number` | `0.7` | Sampling temperature |
| `maxTokens` | `number` | `1000` | Maximum tokens in response |

## Related Packages

- [`@charivo/llm-provider-openclaw`](../llm-provider-openclaw) — Server-side OpenClaw provider
- [`@charivo/llm-client-remote`](../llm-client-remote) — HTTP proxy client (CORS-safe alternative)
- [`@charivo/core`](../core) — Core interfaces

## See Also

- [OpenClaw OpenAI-compatible HTTP API](https://docs.openclaw.ai/gateway/openai-http-api)

## License

MIT
