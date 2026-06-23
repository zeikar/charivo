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
  createRealtimeManager,
  type RealtimeToolRegistration,
} from "@charivo/realtime";
import {
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/realtime-avatar";
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

const manager = createRealtimeManager(client, {
  tools,
  resultProjectors: [createAvatarResultProjector()],
});
```

If your app also renders lipsync locally, prepare audio from a user gesture
before the first realtime session:

```ts
await renderManager.prepareAudio?.();
await manager.startSession({
  provider: "openai",
  model: "gpt-realtime-mini",
});
```

Typical session start:

```ts
await manager.startSession({
  provider: "openai",
  model: "gpt-realtime-mini",
});
```

`gpt-realtime-mini` is the default realtime model; the full `gpt-realtime` is available but meaningfully more expensive—consult [OpenAI's pricing page](https://openai.com/api/pricing/) before switching.

### Input Audio Transcription

`RealtimeSessionConfig.inputAudioTranscription` controls how the provider
transcribes the user's microphone input. Leave it unset to preserve the
provider's current default; the field is fully optional and lands under
`audio.input.transcription` on the wire (OpenAI Realtime GA shape).

```ts
// Cheaper transcription model.
await manager.startSession({
  provider: "openai",
  inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
});

// Higher-quality transcription model.
await manager.updateSession({
  inputAudioTranscription: { model: "gpt-4o-transcribe" },
});

// Skip user transcription entirely (useful when your UI never shows it).
await manager.updateSession({
  inputAudioTranscription: { enabled: false },
});
```

Model strings pass through to OpenAI without local validation, so unknown
values surface as upstream errors. Known options today include `whisper-1`
(default), `gpt-4o-mini-transcribe`, and `gpt-4o-transcribe`.

If you need stronger product-specific acting guidance, append it in the app
layer on top of the library-generated base instead of making
`@charivo/realtime` own product persona rules:

```ts
import { buildRealtimeSessionConfig } from "@charivo/realtime";
import { buildAvatarControlInstructions } from "@charivo/realtime-avatar";

const base = buildRealtimeSessionConfig({ character });

await manager.startSession({
  provider: "openai",
  model: "gpt-realtime-mini",
  instructions: [
    base.instructions,
    buildAvatarControlInstructions(avatarCatalog),
    "Keep replies short and natural for this product.",
  ].join("\n"),
});
```

`buildRealtimeSessionConfig(...)` already includes character identity,
`description`, `personality`, the generic realtime/tooling rules, and
`character.voice.voiceId` when available. It does not supply provider/model
defaults. OpenAI-specific model and voice fallbacks live in the OpenAI
transport/provider packages, not in the provider-agnostic manager helper.

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
- dev/testing only: pass `apiKey` to mint an ephemeral client secret in the browser (no server), mirroring `@charivo/llm/openai` / `@charivo/tts/openai`

```ts
import { createRealtimeManager } from "@charivo/realtime";
import { createOpenAIRealtimeAgentsClient } from "@charivo/realtime/openai-agents";

// Dev/testing only — the key is exposed in the browser.
const manager = createRealtimeManager(
  createOpenAIRealtimeAgentsClient({ apiKey: "sk-..." }),
);
```

Option precedence is `sessionBootstrap` > `apiEndpoint` > `apiKey`. The `apiKey`
path additionally needs microphone permission, a secure context
(`localhost`/`https`), and a user gesture to start; the minted secret is
short-lived and re-minted per session. Use the server-mediated
[Provider Route](#provider-route) below for production.

### Legacy Low-Level OpenAI Transport

- `@charivo/realtime/openai`
- older low-level OpenAI WebRTC path
- mainly useful for legacy compatibility and debugging

## What `@charivo/realtime` Owns

- session state
- tool registry
- typed session config helpers
- in-place `updateSession(...)` session patching
- reconnect orchestration and reconnect observability events
- relaying realtime output into the Charivo event stream

`RealtimeManager` intentionally uses `setEventEmitter(...)`, not the full event
bus. It emits realtime, tool, text, and lip-sync related events back into core.

Local tool calls are checked against the registered tool definition before the
handler runs. The built-in validator covers `required`, `enum`, and basic JSON
Schema `type` fields; invalid arguments emit `realtime:tool:error` and return a
failure tool result. Nested object/array schemas, `additionalProperties`, and
union `type` arrays are not enforced.

Avatar expression/motion/gaze tools are optional and now live in
`@charivo/realtime-avatar`. Use a result projector when you want those tool
results bridged back into `realtime:expression`, `realtime:motion`, and
`realtime:gaze`.

## Reconnect Behavior

When the browser transport drops temporarily, the manager keeps the realtime
session active and attempts recovery with the latest effective config.

- `state.session.status` stays `"active"` during recovery
- `state.connection` switches back to `"connecting"` until recovery succeeds
- successful reconnects do not emit synthetic `realtime:session:start/end`
- `updateSession(...)` still updates the cached base config while reconnecting
- `sendMessage(...)`, `sendAudioChunk(...)`, and `interrupt()` reject while the
  connection is recovering
- `realtime:reconnect:attempt`, `realtime:reconnect:success`, and
  `realtime:reconnect:exhausted` are emitted for observability

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

If `model` or `voice` are omitted from an OpenAI realtime session, the OpenAI
provider applies its OpenAI-specific defaults before calling OpenAI. Apps can
still pass those fields explicitly when they need deterministic provider
configuration. For pricing information on the available models, see [OpenAI's pricing page](https://openai.com/api/pricing/).

For local development without a server, the direct Agents transport can mint the
client secret in the browser via `apiKey` — see
[OpenAI Agents SDK Transport](#openai-agents-sdk-transport) (dev/testing only).

## Alternatives

- Use the direct Agents transport package when you need to own the realtime transport client directly in the browser.
- Use the legacy low-level package only when you intentionally depend on the older `openai-webrtc` flow.
- Use turn-based [STT](./stt.md) and [TTS](./tts.md) when you do not need continuous live sessions.

## References

- [Realtime Package README](https://github.com/zeikar/charivo/blob/main/packages/realtime/README.md)
