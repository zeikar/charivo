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
  type ToolRegistration,
} from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";

const client = createRemoteRealtimeClient({ apiEndpoint: "/api/realtime" });
const tools: ToolRegistration[] = [
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
  model: "gpt-realtime-2.1-mini",
});

// Or Gemini Live, over the same remote client and route:
await manager.startSession({ provider: "gemini", transport: "websocket" });
```

The remote client picks its browser adapter from that `provider`/`transport`
pair — OpenAI Realtime over WebRTC (the default transport) or Gemini Live over
WebSocket — and your route dispatches to `@charivo/server/openai` or
`@charivo/server/gemini` on the same field.

`gpt-realtime-2.1-mini` is the default OpenAI realtime model; the full `gpt-realtime-2.1` is available but meaningfully more expensive — consult [OpenAI's pricing page](https://developers.openai.com/api/docs/pricing) before switching. The Gemini default is `gemini-3.1-flash-live-preview`, the model the transport was measured against.

`createRealtimeManager` guarantees `prepareAudio` and `setEventEmitter`, so
calls on its result need no `?.`. A variable typed as the core
`RealtimeManager` still does — a third-party manager may omit them.

For iOS-safe lip-sync, call `prepareAudio()` from the same user gesture that
starts the session, before `startSession(...)`. Pass the same session config to
both calls — `prepareAudio` needs it to resolve which remote adapter to warm up:

```ts
const sessionConfig = {
  provider: "openai",
  model: "gpt-realtime-2.1-mini",
};

await manager.prepareAudio(sessionConfig);
await manager.startSession(sessionConfig);
```

On an OpenAI session, `updateSession(...)` patches the live session in place
(Gemini Live refuses live patches — see [Session Refresh](#session-refresh)):

```ts
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

## No-server dev (OpenAI Agents transport)

For local development you can skip the server route: pass an OpenAI API key to
the direct Agents transport client and it mints a short-lived realtime client
secret in the browser, mirroring `@charivo/llm/openai` and `@charivo/tts/openai`.

```ts
import { createRealtimeManager } from "@charivo/realtime";
import { createOpenAIRealtimeAgentsClient } from "@charivo/realtime/openai-agents";

// Dev/testing only: the API key is exposed in the browser.
const client = createOpenAIRealtimeAgentsClient({ apiKey: "sk-..." });
const manager = createRealtimeManager(client);

await manager.startSession({ provider: "openai", model: "gpt-realtime-2.1-mini" });
```

`createOpenAIRealtimeAgentsClient` option precedence is `sessionBootstrap` >
`apiEndpoint` > `apiKey`. The `apiKey` path is dev/testing only and additionally
requires microphone permission, a secure context (`localhost` or `https`), and a
user gesture to start; the minted client secret is short-lived (re-minted per
session). For production, use the server-mediated `@charivo/realtime/remote`
client shown above. There is no equivalent for Gemini Live:
`@charivo/realtime/gemini` takes only `apiEndpoint` or `sessionBootstrap` and
never a key.

## Exports

- `createRealtimeManager(client, options?)`
- `buildRealtimeSessionConfig({ character, baseConfig? })`
- `DEFAULT_REALTIME_AGENT_INSTRUCTIONS`
- realtime-related types re-exported from `@charivo/core`
- `ToolResultProjector` (re-exported from `@charivo/core`) — use this for
  `resultProjectors`
- `RealtimeLogger`

Transport clients live on subpaths:

- `@charivo/realtime/remote`: `createRemoteRealtimeClient(config?)`, plus
  `DEFAULT_REMOTE_REALTIME_ADAPTERS` — the registry it resolves from, keyed by
  the adapter ids exported from `@charivo/core`
- `@charivo/realtime/openai-agents`: `createOpenAIRealtimeAgentsClient(options?)`
  — OpenAI Realtime over WebRTC through the OpenAI Agents SDK
- `@charivo/realtime/openai`: `createOpenAIRealtimeClient(options?)` — the
  legacy low-level OpenAI WebRTC transport
- `@charivo/realtime/gemini`: `createGeminiLiveClient(options?)` — Gemini Live
  over WebSocket; no `apiKey` option (`apiEndpoint` or `sessionBootstrap` only),
  captures the microphone at 16 kHz and plays the model's 24 kHz PCM through
  its own scheduler with a lip-sync tap

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
  model: "gpt-realtime-2.1-mini",
  instructions: [
    base.instructions,
    "Keep replies short and natural for this product.",
  ].join("\n"),
});
```

`buildRealtimeSessionConfig(...)` does not fill provider-specific fields such
as `provider` or `model`. Prefer building on top of it for instructions and
character voice, then pass provider/model explicitly at `startSession(...)`.
Each transport/provider pair keeps its own fallbacks for omitted model or voice
values: the OpenAI packages theirs, and `@charivo/server/gemini`
`gemini-3.1-flash-live-preview` with the `Kore` voice — which is also what a
voice id it does not recognise (an OpenAI one, say) silently becomes.

Avatar-specific realtime tools and avatar-specific instruction addenda now live
in `@charivo/avatar` (works with both `@charivo/realtime` and `@charivo/llm`;
formerly published as `@charivo/realtime-avatar`). Append those
instructions only in sessions that register avatar tools so `@charivo/realtime`
stays tool-agnostic.

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
} from "@charivo/avatar";

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
additional app-level events such as `avatar:expression`. They receive the JSON
snapshot of the handler result — exactly what was sent to the transport — not
the live handler object. `@charivo/llm` hands its projectors the same snapshot,
so one projector behaves identically on both paths.

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
  session patch — which `@charivo/realtime/gemini` rejects outright: a Gemini
  Live session is fixed when its token is minted (the token's setup replaces
  the browser's, measured), and the Live API has no `session.update`. The call
  rejects, `realtime:error` carries the same error, and the live session keeps
  the configuration it started with; stop and start a new session to change it,
  and register tools before `startSession(...)`
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
- on Gemini Live every attempt re-mints through your route — tokens are
  `uses: 1`, and replaying one closes the socket with `1011` (measured) — and
  the recovered session is a fresh one: `sessionResumptionUpdate` handles are
  not spent, `goAway` is not acted on (the close after it drives this same
  recovery), and the transport's microphone gate re-arms

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
`tool:error` is emitted and a `{ success: false, error }` result is sent back
to the transport. Nested object/array schemas, `additionalProperties`, and
union `type` arrays are not enforced.

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

Live registration:

- `registerTool(...)` and `unregisterTool(...)` update the local registry immediately
- an active OpenAI session is patched automatically, so no explicit `updateSession(...)` is needed; a live Gemini Live session refuses the patch (see [Session Refresh](#session-refresh)), so register tools before starting it
- a change made while a response is in flight is deferred to just after it, and several deferred changes collapse into one refresh
- both return `void`; a failed patch surfaces as `realtime:error`, not a rejection
- until that patch lands, an already-active session may still call a just-unregistered tool, which returns a failure result

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
- `tool:call`
- `tool:result`
- `tool:error`
- `realtime:usage`
- `realtime:error`
- `tts:lipsync:update`
- `tts:audio:start`
- `tts:audio:end`

`tts:audio:end` reports that playback finished, not that the server finished
sending — send completion can precede it by a wide margin. The OpenAI
transports derive it from `output_audio_buffer.stopped` (and
`output_audio_buffer.cleared` on an interruption), never from
`response.audio.done` / `response.output_audio.done`. The Gemini transport
plays the audio itself and ends it only when its scheduler has drained AND the
server's `turnComplete` has arrived — neither alone, because the scheduler
drains spuriously at the start of a turn and `turnComplete` is paced by a
server clock rather than observed from playback (both measured).
Consumers act on this event — `RenderManager` releases a held expression and
stops lip-sync there — so a custom transport that reports it at send completion
will reset the avatar's face mid-reply. See
[docs/guide/realtime.md](../../docs/guide/realtime.md#audio-output-lifecycle).

`RealtimeState.audioPlaying` exposes the same playback segment as state, which is
what to read when you need to know whether the character is still talking.
`response.status` answers a different question — it completes when the provider
closes the response, at send completion on OpenAI and at the clock-paced
`turnComplete` on Gemini, while playback runs on — so anything gated on it is
wrong for the tail of every turn. `RealtimeState.awaitingResponse` reports whether a reply is
still expected, which is the response-in-progress condition `sendMessage`
refuses on.
