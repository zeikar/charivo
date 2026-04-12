# @charivo/realtime-core

Provider-agnostic realtime session manager and typed config helpers for Charivo.

## Install

```bash
pnpm add @charivo/realtime-core
```

## Usage

```ts
import {
  buildRealtimeSessionConfig,
  createRealtimeManager,
} from "@charivo/realtime-core";
import { createRemoteRealtimeClient } from "@charivo/realtime-client-remote";

const client = createRemoteRealtimeClient({ apiEndpoint: "/api/realtime" });
const manager = createRealtimeManager(client);
manager.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
  voice: { voiceId: "marin" },
});

await manager.startSession(
  buildRealtimeSessionConfig({
    character: {
      id: "hiyori",
      name: "Hiyori",
      personality: "Cheerful and helpful assistant",
      voice: { voiceId: "marin" },
    },
    baseConfig: {
      provider: "openai",
      model: "gpt-realtime-mini",
    },
  }),
);
```

## Exports

- `createRealtimeManager(client, options?)`
- `buildRealtimeSessionConfig({ character, baseConfig? })`
- `setEmotionTool`
- `DEFAULT_REALTIME_AGENT_INSTRUCTIONS`
- realtime-related types re-exported from `@charivo/core`

## Event Bridge

`RealtimeManager` accepts an emit-only event bridge through
`setEventEmitter(...)`. It relays client output into the Charivo event stream,
but it does not subscribe through the shared event bus.

When connected, the manager relays:

- `realtime:session:start`
- `realtime:session:end`
- `realtime:state`
- `realtime:user:transcript`
- `realtime:assistant:start`
- `realtime:assistant:delta`
- `realtime:assistant:done`
- `realtime:tool:call`
- `realtime:tool:result`
- `realtime:text:delta`
- `realtime:emotion`
- `realtime:error`
- `tts:lipsync:update`
- `tts:audio:start`
- `tts:audio:end`
