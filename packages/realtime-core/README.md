# @charivo/realtime-core

Provider-agnostic realtime session manager and typed config helpers for Charivo.

## Install

```bash
pnpm add @charivo/realtime-core
```

## Usage

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
manager.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
  voice: { voiceId: "marin" },
});

await manager.startSession({
  provider: "openai",
  model: "gpt-realtime-mini",
});

await manager.updateSession({
  voice: "alloy",
});
```

## Exports

- `createRealtimeManager(client, options?)`
- `buildRealtimeSessionConfig({ character, baseConfig? })`
- `createAvatarControlTools(catalog)`
- `DEFAULT_REALTIME_AGENT_INSTRUCTIONS`
- realtime-related types re-exported from `@charivo/core`

## Avatar Control Tools

Use `createAvatarControlTools(...)` to build canonical avatar tools from the
loaded Live2D model catalog:

- `setExpression`
- `playMotion`
- `lookAt`

## Session Refresh

`updateSession(...)` refreshes the active provider session by reconnecting with
the latest requested config, current character, and current tool registry.

- inactive managers only cache the requested base config for the next
  `startSession(...)`
- active managers reconnect instead of attempting a transport-level patch
- refresh lifecycle events use `reason: "refresh"` on
  `realtime:session:end/start`
- refresh failures do not roll back to the previous live session
- `state.session.config` is only replaced after the new connection succeeds
- repeated `updateSession(...)` calls are coalesced to the latest config
- `stopSession()` wins over an in-flight refresh and converges to a stopped
  session

## Tool Registry

`RealtimeManager` owns the tool registry. Definitions sent to the provider come
from the registry, not from `defaultSessionConfig.tools`.

```ts
manager.registerTool({
  definition: {
    type: "function",
    name: "describeScene",
    description: "Describe the current scene.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async handler() {
    return {
      success: true,
      scene: "Cafe",
    };
  },
});
```

Current limitation:

- `registerTool(...)` and `unregisterTool(...)` update the local manager registry immediately
- active provider sessions are not updated until `updateSession(...)` or the next `startSession(...)`
- unregistered tools may still be called by an already-active provider session and will return a failure result

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
- `realtime:tool:error`
- `realtime:expression`
- `realtime:motion`
- `realtime:gaze`
- `realtime:text:delta`
- `realtime:error`
- `tts:lipsync:update`
- `tts:audio:start`
- `tts:audio:end`
