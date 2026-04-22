---
title: Realtime
sidebar_position: 9
---

# Realtime

Use Charivo's realtime stack when you want session-based voice interaction,
streaming assistant output, or tool-enabled voice workflows.

## Recommended Stack

```text
@charivo/realtime
@charivo/realtime/remote
your /api/realtime route
@charivo/server/openai
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
} from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";

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

If you need stronger product-specific acting guidance, append it in the app
layer on top of the library-generated base instead of making
`@charivo/realtime` own product persona rules:

```ts
import { buildRealtimeSessionConfig } from "@charivo/realtime";

const base = buildRealtimeSessionConfig({ character });

await manager.startSession({
  provider: "openai",
  instructions: [
    base.instructions,
    "Keep replies short and natural for this product.",
  ].join("\n"),
});
```

`buildRealtimeSessionConfig(...)` already includes character identity,
`description`, `personality`, and the generic realtime/tooling rules.

## Why `@charivo/realtime/remote` Is The Default

- it is the recommended production path
- it works through your own server route
- it resolves a browser transport adapter from its registry
- the built-in resolver maps OpenAI WebRTC traffic to the current adapter defaults

Today, that usually means the OpenAI Agents WebRTC bootstrap flow.

## Client Choices

### Remote

- `@charivo/realtime/remote`
- best default for production browser apps
- adapter-aware and server-mediated

### OpenAI Agents SDK Transport

- `@charivo/realtime/openai-agents`
- current OpenAI Agents SDK transport client and adapter
- useful when you need to own the underlying browser client directly

### Legacy Low-Level OpenAI Transport

- `@charivo/realtime/openai`
- older low-level OpenAI WebRTC path
- mainly useful for legacy compatibility and debugging

## What `@charivo/realtime` Owns

- session state
- tool registry
- typed session config helpers
- in-place `updateSession(...)` session patching
- relaying realtime output into the Charivo event stream

Canonical avatar control is expression/motion/gaze-first:

- `setExpression`
- `playMotion`
- `lookAt`

`RealtimeManager` intentionally uses `setEventEmitter(...)`, not the full event
bus. It emits realtime, tool, text, avatar action, and lip-sync related events
back into core.

## Provider Route

The server route typically uses `@charivo/server/openai`:

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

- [Realtime Package README](https://github.com/zeikar/charivo/blob/main/packages/realtime/README.md)
