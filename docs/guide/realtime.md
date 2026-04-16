---
title: Realtime
sidebar_position: 9
---

# Realtime

Use Charivo's realtime stack when you want session-based voice interaction,
streaming assistant output, or tool-enabled voice workflows.

## Recommended Stack

```text
@charivo/realtime-core
@charivo/realtime-client-remote
your /api/realtime route
@charivo/realtime-provider-openai
```

This is the current production-oriented browser path. The browser calls your
route, receives an adapter-aware bootstrap, and connects through the default
remote adapter registry.

## Basic Setup

```ts
import {
  createAvatarControlTools,
  createRealtimeManager,
  type RealtimeToolRegistration,
} from "@charivo/realtime-core";
import { createRemoteRealtimeClient } from "@charivo/realtime-client-remote";

const client = createRemoteRealtimeClient({ apiEndpoint: "/api/realtime" });
const avatarTools = createAvatarControlTools({
  expressions: ["Smile", "Sad"],
  motions: { Idle: 2, TapBody: 3 },
});

const tools: RealtimeToolRegistration[] = [
  ...avatarTools,
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

Today, that usually means the OpenAI Agents WebRTC bootstrap flow.

## Client Choices

### Remote

- `@charivo/realtime-client-remote`
- best default for production browser apps
- adapter-aware and server-mediated

### OpenAI Agents SDK Transport

- `@charivo/realtime-client-openai-agents`
- current OpenAI Agents SDK transport client and adapter
- useful when you need to own the underlying browser client directly

### Legacy Low-Level OpenAI Transport

- `@charivo/realtime-client-openai`
- older low-level OpenAI WebRTC path
- mainly useful for legacy compatibility and debugging

## What `realtime-core` Owns

- session state
- tool registry
- typed session config helpers
- reconnect-driven `updateSession(...)`
- relaying realtime output into the Charivo event stream

Canonical avatar control is expression/motion/gaze-first:

- `setExpression`
- `playMotion`
- `lookAt`

`setEmotion` still exists as a deprecated compatibility shorthand when you need
to bridge older `emotionMappings`-based integrations.

`RealtimeManager` intentionally uses `setEventEmitter(...)`, not the full event
bus. It emits realtime, tool, text, emotion, and lip-sync related events back
into core.

## Provider Route

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

## Alternatives

- Use the direct Agents transport package when you need to own the realtime transport client directly in the browser.
- Use the legacy low-level package only when you intentionally depend on the older `openai-webrtc` flow.
- Use turn-based [STT](./stt.md) and [TTS](./tts.md) when you do not need continuous live sessions.

## References

- [realtime-core README](https://github.com/zeikar/charivo/blob/main/packages/realtime-core/README.md)
- [realtime-client-remote README](https://github.com/zeikar/charivo/blob/main/packages/realtime-client-remote/README.md)
- [realtime-client-openai-agents README](https://github.com/zeikar/charivo/blob/main/packages/realtime-client-openai-agents/README.md)
- [realtime-provider-openai README](https://github.com/zeikar/charivo/blob/main/packages/realtime-provider-openai/README.md)
