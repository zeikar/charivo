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
  baseURL: process.env.OPENCLAW_BASE_URL!,
  // Optional: target a specific agent. Omit to use the gateway's default agent.
  agentId: process.env.OPENCLAW_AGENT_ID,
  // Optional: pin the conversation to a server-side session on the gateway.
  sessionKey: conversationId,
});
```

The OpenClaw gateway keeps conversation state server-side. Without `sessionKey` it
opens a fresh session per request: the caller's message history is still sent, so
the model sees prior turns, but the gateway persists nothing between requests and
each turn strands a throwaway session. Pass a conversation-scoped identifier (a
UUID per conversation, rotated when the user resets the chat) to keep turns on one
session; past turns are then left to the gateway instead of being resent. Rotating
`sessionKey` is the only way to reset a pinned conversation — the gateway keeps the
old transcript under the old key.

## Exports

- `@charivo/server/openai`: `createOpenAILLMProvider`, `createOpenAITTSProvider`, `createOpenAISTTProvider`, `createOpenAIRealtimeProvider`
- `@charivo/server/openclaw`: `createOpenClawLLMProvider`
