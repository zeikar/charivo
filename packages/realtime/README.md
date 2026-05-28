# @charivo/realtime

Provider-agnostic realtime session manager and typed config helpers for Charivo.

## Install

```bash
pnpm add @charivo/realtime
```

## Usage

```ts
import {
  createRealtimeManager,
  type RealtimeToolRegistration,
} from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";

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

// Switch the user-transcription model (cost vs. quality), or disable it.
await manager.updateSession({
  inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
});

// Disable user transcription entirely (no whisper-1 charge):
await manager.updateSession({
  inputAudioTranscription: { enabled: false },
});
```

If the live transport drops temporarily, `RealtimeManager` now keeps the
session active and drives reconnect attempts internally. During that window
`state.session.status` stays `"active"` while `state.connection` moves back to
`"connecting"`.

## Exports

- `createRealtimeManager(client, options?)`
- `buildRealtimeSessionConfig({ character, baseConfig? })`
- `DEFAULT_REALTIME_AGENT_INSTRUCTIONS`
- realtime-related types re-exported from `@charivo/core`
- `RealtimeToolResultProjector`
- `RealtimeLogger`

## Instruction Layering

`@charivo/realtime` keeps its default instructions generic: spoken-output
constraints, tool-use restraint, stage-direction suppression, and basic
in-character behavior.

`buildRealtimeSessionConfig({ character, baseConfig? })` already folds in:

- character identity (`You are ...`)
- `character.description`
- `character.personality`
- the generic realtime defaults
- `character.voice.voiceId` when available

If your app needs stronger product-specific acting guidance, append it in the
app layer instead of expanding the library default prompt:

```ts
const base = buildRealtimeSessionConfig({ character });

await manager.startSession({
  provider: "openai",
  model: "gpt-realtime-mini",
  instructions: [
    base.instructions,
    "Keep replies short and natural for this product.",
  ].join("\n"),
});
```

`buildRealtimeSessionConfig(...)` does not fill provider-specific fields such
as `provider` or `model`. Prefer building on top of it for instructions and
character voice, then pass provider/model explicitly at `startSession(...)`.
OpenAI transport packages and `@charivo/server/openai` keep their own
OpenAI-specific fallbacks for omitted model or voice values.

Avatar-specific realtime tools and avatar-specific instruction addenda now live
in `@charivo/realtime-avatar`. Append those instructions only in sessions that
register avatar tools so `@charivo/realtime` stays tool-agnostic.

## Result Projectors And Logging

`RealtimeManager` stays renderer-neutral. If your app wants domain-specific
events from tool outputs, pass `resultProjectors`:

```ts
import {
  buildRealtimeSessionConfig,
  createRealtimeManager,
} from "@charivo/realtime";
import {
  buildAvatarControlInstructions,
  createAvatarResultProjector,
} from "@charivo/realtime-avatar";

const base = buildRealtimeSessionConfig({ character });

const manager = createRealtimeManager(client, {
  tools,
  resultProjectors: [createAvatarResultProjector()],
  logger: console,
});

await manager.startSession({
  provider: "openai",
  instructions: [
    base.instructions,
    buildAvatarControlInstructions(avatarCatalog),
  ].join("\n"),
});
```

`resultProjectors` run after successful local tool execution and can emit
additional app-level events such as `realtime:expression`.

When a logger is configured, `RealtimeManager` also injects a per-session
`sessionId` into every log context. If the caller also supplies `sessionId` in
its own logger context, the manager value wins. The same `sessionId` is
included in `realtime:usage` payloads.

## Session Refresh

`updateSession(...)` patches the active provider session in place using the
latest requested config, current character, and current tool registry.

- inactive managers only cache the requested base config for the next
  `startSession(...)`
- active managers keep the current connection open and issue a transport-level
  session patch
- successful patches update `realtime:state` only and do not emit synthetic
  `realtime:session:end/start` refresh boundaries
- patch failures keep the current live session and previous
  `state.session.config` in place
- `state.session.config` is only replaced after the patch succeeds
- repeated `updateSession(...)` calls are coalesced to the latest config
- `stopSession()` wins over an in-flight refresh and converges to a stopped
  session

## Reconnect Semantics

Successful reconnects are treated as a continuation of the same live session.

- successful recovery does not emit synthetic `realtime:session:end/start`
- `updateSession(...)` still updates the cached base config while reconnecting
- `sendMessage(...)`, `sendAudioChunk(...)`, `interrupt()`, and transport-level
  tool results reject while `connection === "connecting"`
- the next reconnect attempt always rebuilds from the latest effective config
- in-flight assistant responses are marked as interrupted and are not resumed
- old tool-call ids are not replayed after reconnect

Observability events emitted by the manager:

- `realtime:reconnect:attempt`
- `realtime:reconnect:success`
- `realtime:reconnect:exhausted`

## Tool Registry

`RealtimeManager` owns the tool registry. Definitions sent to the provider come
from the registry, not from `defaultSessionConfig.tools`.

Before invoking a local tool handler, the manager validates incoming tool
arguments against the tool definition's `required`, `enum`, and basic JSON
Schema `type` fields. Invalid arguments follow the normal tool failure path:
`realtime:tool:error` is emitted and a `{ success: false, error }` result is
sent back to the transport. Nested object/array schemas, `additionalProperties`,
and union `type` arrays are not enforced.

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
- `realtime:usage`
- `realtime:text:delta`
- `realtime:error`
- `tts:lipsync:update`
- `tts:audio:start`
- `tts:audio:end`
