# @charivo/realtime-core

Realtime session manager and typed OpenAI Realtime helpers for Charivo.

## Install

```bash
pnpm add @charivo/realtime-core
```

## Usage

```ts
import {
  createRealtimeManager,
  getEmotionSessionConfig,
} from "@charivo/realtime-core";
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";

const client = createOpenAIRealtimeClient({ apiEndpoint: "/api/realtime" });
const manager = createRealtimeManager(client);

await manager.startSession(
  getEmotionSessionConfig({
    model: "gpt-realtime-mini",
    voice: "marin",
  }),
);
```

## Exports

- `createRealtimeManager(client)`
- `getEmotionSessionConfig(overrides?)`
- `setEmotionTool`
- `DEFAULT_EMOTION_INSTRUCTIONS`
- realtime-related types re-exported from `@charivo/core`

## Event Bridge

When connected to the Charivo event bus, the manager relays:

- `realtime:text:delta`
- `realtime:emotion`
- `realtime:error`
- `tts:lipsync:update`
- `tts:audio:start`
- `tts:audio:end`
