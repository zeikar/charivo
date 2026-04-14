# Realtime

This guide answers one question: how should you add realtime voice sessions to
a Charivo app?

Use it when you want session-based voice interaction, streaming assistant
output, or tool-enabled realtime workflows.

## Recommended Default

For current production-oriented browser apps, use:

```text
@charivo/realtime-core
@charivo/realtime-client-remote
your /api/realtime route
@charivo/realtime-provider-openai
```

This path lets the browser call your route, receive an adapter-aware bootstrap,
and connect through the default remote adapter registry.

## Core Wiring

```ts
import {
  createRealtimeManager,
  type RealtimeToolRegistration,
} from "@charivo/realtime-core";
import { createRemoteRealtimeClient } from "@charivo/realtime-client-remote";

const client = createRemoteRealtimeClient({ apiEndpoint: "/api/realtime" });

const tools: RealtimeToolRegistration[] = [
  {
    definition: {
      type: "function",
      name: "describeCharacterProfile",
      description: "Return the active character profile.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    async handler(_args, context) {
      return {
        success: true,
        name: context.character?.name ?? null,
      };
    },
  },
];

const manager = createRealtimeManager(client, { tools });
```

Typical session start:

```ts
await manager.startSession({
  provider: "openai",
  model: "gpt-realtime-mini",
});
```

## Why `realtime-client-remote` Is The Default

- it is the recommended production path
- it works through your own server route
- it resolves a browser transport adapter from its registry
- the built-in resolver maps OpenAI WebRTC traffic to the current adapter defaults

Today, that default route can return the OpenAI Agents WebRTC bootstrap flow.

## Client Choices

### Remote

- `@charivo/realtime-client-remote`
- best default for production browser apps
- adapter-aware and server-mediated

### OpenAI Agents SDK Transport

- `@charivo/realtime-client-openai-agents`
- the current OpenAI Agents SDK transport client and adapter
- useful when you need the underlying client directly rather than going through the remote adapter layer

### Legacy Low-Level OpenAI Transport

- `@charivo/realtime-client-openai`
- older low-level OpenAI WebRTC path
- keep this mainly for legacy compatibility and specialized debugging

## What `realtime-core` Owns

- session state
- tool registry
- typed session config helpers
- reconnect-driven `updateSession(...)`
- relaying realtime output into the Charivo event stream

`RealtimeManager` intentionally uses `setEventEmitter(...)`, not the full event
bus. It emits realtime, tool, text, emotion, and lip-sync related events back
into core.

## Provider Path

The server route typically uses `@charivo/realtime-provider-openai`:

```ts
const provider = createOpenAIRealtimeProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});

const bootstrap = await provider.createSession({
  adapter: "openai-agents-webrtc",
  transport: "webrtc",
  session: {
    provider: "openai",
    model: "gpt-realtime-mini",
    voice: "marin",
  },
});
```

## When To Use Another Path

- Use the direct Agents transport package when you need to own the realtime transport client directly in the browser.
- Use the legacy low-level package only when you intentionally depend on the older `openai-webrtc` flow.
- Use turn-based [STT](./stt.md) + [TTS](./tts.md) when you do not need continuous live sessions.

## References

- [realtime-core README](../../packages/realtime-core/README.md)
- [realtime-client-remote README](../../packages/realtime-client-remote/README.md)
- [realtime-client-openai-agents README](../../packages/realtime-client-openai-agents/README.md)
- [realtime-provider-openai README](../../packages/realtime-provider-openai/README.md)

## Next Steps

- [Choosing Packages](./choosing-packages.md)
- [Examples Web](./examples-web.md)
- [Architecture](./architecture.md)
