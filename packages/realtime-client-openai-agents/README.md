# @charivo/realtime-client-openai-agents

OpenAI Agents SDK based realtime transport client for Charivo.

This package wraps `RealtimeAgent` and `RealtimeSession` from the OpenAI Agents
Realtime SDK and normalizes their behavior into the transport contract used by
`@charivo/realtime-core`.

## Install

```bash
pnpm add @charivo/realtime-client-openai-agents
```

## Usage

```ts
import { createOpenAIRealtimeAgentsClient } from "@charivo/realtime-client-openai-agents";

const client = createOpenAIRealtimeAgentsClient({
  apiEndpoint: "/api/realtime",
  debug: false,
});
```

## Notes

- Browser WebRTC connections use ephemeral client secrets
- Tool execution stays in `@charivo/realtime-core`
- Lip-sync values are derived from the remote MediaStream audio output
- For production apps, prefer `@charivo/realtime-client-remote`
