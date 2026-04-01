# @charivo/llm-client-remote

Browser-side LLM client for server API routes.

This is the default production path for browser apps: the browser sends messages
to your own API route, and the server route talks to the provider package.

## Install

```bash
pnpm add @charivo/llm-client-remote
```

## Usage

```ts
import { createRemoteLLMClient } from "@charivo/llm-client-remote";

const client = createRemoteLLMClient({ apiEndpoint: "/api/chat" });

const message = await client.call([
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hello" },
]);
```

## Request Contract

`RemoteLLMClient` sends:

```json
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

The current client expects a JSON response shaped like:

```json
{
  "success": true,
  "message": "assistant response"
}
```

## Config

- `apiEndpoint?`: defaults to `/api/chat`
