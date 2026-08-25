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

Add `@charivo/avatar` (a separate install) if you want its avatar
expression/motion/gaze tools and result projector, as used in the Basic Setup
example below. The same tools also work with `@charivo/llm`'s `LLMManager` —
see [LLM — Avatar Tool Calling](./llm.md#avatar-tool-calling).

## Basic Setup

```ts
import { createCharivo } from "@charivo/core";
import {
  createRealtimeManager,
  type ToolRegistration,
} from "@charivo/realtime";
import {
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";

const client = createRemoteRealtimeClient({ apiEndpoint: "/api/realtime" });

// Declared once and reused below — the instruction-layering example further
// down builds on both of these.
const character = {
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
  voice: { voiceId: "marin" },
};

const avatarCatalog = {
  expressions: ["Smile", "Sad"],
  motions: { Idle: 2, TapBody: 3 },
  expressionDescriptions: {
    Smile: "happy or amused",
    Sad: "downcast or disappointed",
  },
  // Positional: index 0 describes motion index 0.
  motionDescriptions: {
    Idle: ["resting", "shifting weight"],
    TapBody: ["waves hello", "folds her arms", "startled step back"],
  },
};

const avatarTools = createAvatarControlTools(avatarCatalog);

const tools: ToolRegistration[] = [
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

const charivo = createCharivo({ realtime: manager, character });
```

`attachRealtime(...)` installs the event bridge that relays realtime output
(including projected avatar events) into the Charivo event stream and
propagates the current character to the manager. Set the character before
starting the session so tool handlers and instructions have access to it.

For iOS-safe lip-sync, prepare audio from a user gesture before the first
realtime session. Pass the same session config to both calls — `prepareAudio`
needs it to resolve which remote adapter to warm up:

```ts
const sessionConfig = {
  provider: "openai",
  model: "gpt-realtime-2.1-mini",
};

await manager.prepareAudio(sessionConfig);
await manager.startSession(sessionConfig);
```

`gpt-realtime-2.1-mini` is the default realtime model. The full
`gpt-realtime-2.1` is available but meaningfully more expensive — consult
[OpenAI's pricing page](https://developers.openai.com/api/docs/pricing) before
switching.

### Input Audio Transcription

`RealtimeSessionConfig.inputAudioTranscription` controls how the provider
transcribes the user's microphone input. Leave it unset to leave input
transcription disabled — OpenAI's Realtime API defaults transcription to off,
so set `model` explicitly if you want user transcripts. The field is fully
optional and lands under `audio.input.transcription` on the wire (OpenAI
Realtime GA shape).

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
values surface as upstream errors. Known options today include `whisper-1`,
`gpt-4o-mini-transcribe`, and `gpt-4o-transcribe`; none is applied unless you
set `model` explicitly.

### Instruction Layering

Append product-specific acting guidance in the app layer, on top of the
library-generated base, instead of making `@charivo/realtime` own product
persona rules. Continuing from Basic Setup, with the same `character` and
`avatarCatalog`:

```ts
import { buildRealtimeSessionConfig } from "@charivo/realtime";
import { buildAvatarControlInstructions } from "@charivo/avatar";

const base = buildRealtimeSessionConfig({ character });

await manager.startSession({
  provider: "openai",
  model: "gpt-realtime-2.1-mini",
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

## Client Choices

### Remote

- `@charivo/realtime/remote`
- the default recommended in [Recommended Stack](#recommended-stack): it runs
  through your own server route, so no key reaches the browser
- resolves a browser transport adapter from its registry; the built-in resolver
  maps OpenAI WebRTC traffic to the current adapter defaults, which today means
  the OpenAI Agents WebRTC bootstrap flow

### OpenAI Agents SDK Transport

- `@charivo/realtime/openai-agents`
- current OpenAI Agents SDK transport client and adapter
- useful when you need to own the underlying browser client directly
- dev/testing only: pass `apiKey` to mint an ephemeral client secret in the
  browser (no server), mirroring `@charivo/llm/openai` / `@charivo/tts/openai`

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

## Tools

`registerTool(...)` / `unregisterTool(...)` work on a live session: each one
patches the active session so the model sees the new tool surface without a
reconnect. Nothing is sent while the session is idle — the next
`startSession(...)` picks the registry up — and a change made while a response
is in flight is deferred rather than applied mid-response. Several deferred
changes collapse into a single refresh once that response completes, so
registering a batch of tools costs one session patch, not one per tool.

Both methods return `void` and the refresh is fire-and-forget: if the provider
rejects the patch, the failure surfaces as `realtime:error` rather than as a
rejected call, so watch that event instead of awaiting these.

Tool handlers time out after 10 seconds by default; set `timeoutMs` on a
registration to override it per tool, or `defaultToolTimeoutMs` on the manager
to move the default. A handler must resolve to a plain JSON-serializable object
— the result is snapshotted before it reaches the transport and any result
projectors, so later mutation of the returned object has no effect.

Local tool calls are checked against the registered tool definition before the
handler runs. The built-in validator covers `required`, `enum`, and basic JSON
Schema `type` fields; invalid arguments emit `tool:error` and return a failure
tool result. Nested object/array schemas, `additionalProperties`, and union
`type` arrays are not enforced.

Avatar expression/motion/gaze tools are optional and now live in
`@charivo/avatar` (formerly published as `@charivo/realtime-avatar`).
Use a result projector when you want those tool results bridged back into
`avatar:expression`, `avatar:motion`, and `avatar:gaze`.

## Audio Output Lifecycle

`tts:audio:end` reports that playback finished, not that the server finished
producing the audio. That distinction matters because consumers act on it:
`RenderManager` releases a held expression there and stops lip-sync, so reporting
it early resets the avatar's face partway through its own reply.

(`tts:audio:start` is looser by design — the legacy transport also raises it on
the first audio chunk arriving, so treat it as "output has begun", not as a
precise audibility timestamp.)

Send completion can precede playback completion by a wide margin, and only the
output-buffer events describe playback itself:

| Event | Meaning | Ends audio output? |
| --- | --- | --- |
| `response.audio.done`, `response.output_audio.done` | the server finished SENDING audio; the browser is still playing what it buffered | no |
| `output_audio_buffer.stopped` | playback ran to natural completion | yes |
| `output_audio_buffer.cleared` | an interruption discarded the buffer | yes |

Both WebRTC transports report the end from the output-buffer events. Note that
the OpenAI Agents SDK raises `audio_stopped` on `response.output_audio.done`, so
that SDK event is a send completion despite its name, and its `audio_interrupted`
is emitted only by the SDK's WebSocket transport — never over WebRTC.

No timer or audio-level heuristic stands in for the buffer events. A guessed end
cannot be undone once an expression has been released, so a session that somehow
never observes one holds the expression until something replaces it rather than
risk cutting it short; interruption, connection loss, and teardown still end
audio output explicitly.

If you implement a custom transport, emit `audio.output.ended` when playback
truly stops. Emitting it when your provider finishes streaming will look correct
in logs and wrong on screen.

One more obligation, for interruptions: do not report
`assistant.response.started` or `assistant.response.completed` for a turn the
caller interrupted once a replacement turn has been sent. `RealtimeManager`
credits late lifecycle events to whatever turn is current, so they move the
session back to `"responding"` and then release the replacement's send lock,
admitting a duplicate send.

Both built-in transports honour it for a response the wire proves is in flight
when `interrupt()` runs: any acknowledged response, whether client-requested or
created by server VAD, plus — on the low-level transport — a client-requested
response interrupted before its acknowledgement, across repeated
interrupt-and-replace cycles. That turn's assistant lifecycle events
(`assistant.response.started`, `assistant.text.delta`,
`assistant.response.completed`) are dropped while the suppression holds. Tool
events stay live across an interrupt by design, and audio events keep reporting
real playback.

> **Known gap.** Because the built-in transports condemn only a response the
> wire proves they are interrupting, and de-arm on an unrelated failure, some
> windows stay uncovered. That is a deliberate scope limit, not a fixed
> constraint: closing them needs either an adapter-owned send path or turn
> identity on the lifecycle events.
>
> - Agents transport: an interrupt issued before the turn's first server event.
>   The SDK sends no `response.cancel` there, so nothing marks the turn — which
>   also covers a replacement queued behind a condemned turn and interrupted
>   before it starts.
> - Both transports: a tool call resolving across an interrupt. Its follow-up
>   response can be credited to the replacement, and on the agents transport the
>   SDK can merge the two into a single response.
> - Both transports: a server-VAD turn interrupted before its acknowledgement.
> - Both transports: a transport error arriving while a condemned response is
>   still outstanding. Suppression is dropped there on purpose — staying armed
>   after an unknown failure risks stranding the send lock — so that response's
>   late completion reports as genuine and can release a later turn's lock.
>
> In those windows, interrupting and immediately sending a replacement can leave
> `awaitingResponse` reporting `false` while that replacement is still pending.

### Asking whether the character is still talking

`RealtimeState.audioPlaying` answers that; `state.response.status` does not.

The response completes when the provider finishes sending, so it reads
`"completed"` for the whole tail of every turn while the character is still
audible. Anything gated on it — a barge-in, a "stop" control, a speaking
indicator — is wrong for that window and looks right until someone cuts in near
the end of a reply.

```ts
const state = realtimeManager.getState();

// Still talking, even when the response is already "completed".
if (state.audioPlaying || state.awaitingResponse) {
  await realtimeManager.interrupt();
}

await realtimeManager.sendMessage(text);
```

`awaitingResponse` is the other half: it reports the response-in-progress
condition `sendMessage` refuses on, so you can anticipate that refusal instead
of discovering it as a thrown error. It is wider than
`response.status === "responding"` — it also covers the stretch between a
message going out and the reply starting to stream, where a turn is in flight
but nothing has come back to show for it. Interrupting clears it, as does the
reply completing, an error, a reconnect, or the session ending.

It does not predict every refusal: `sendMessage` also rejects while the session
is inactive or reconnecting, which `session.status` and `connection` report.

On an active, connected session, reading both flags is what lets a text box
barge in the way speaking already does. The session checks still apply.

The field tracks the same playback segment as the events above: true from
`audio.output.started` until `audio.output.ended`, and cleared when a session
stops, fails, or reconnects. Changes publish through `realtime:state`, so there
is no need to track `tts:audio:start` / `tts:audio:end` yourself to reconstruct
it.

## Session Updates

`updateSession(...)` is safe to call at any point. While no session is active it
just caches the configuration for the next `startSession(...)`. While one is
active it patches in place — with one exception worth knowing: while the
connection is recovering the status still reads `"active"`, and an update is
cached instead of sent.

That cached value only reaches a reconnect attempt that has not built its config
yet. Each attempt resolves its effective config before awaiting recovery, so an
update made after that point does not apply to an attempt that then succeeds —
recovery commits the config it already built and issues no follow-up patch. If
you update during recovery and it matters, call `updateSession(...)` again once
the connection is back.

Updates that arrive while a patch is in flight do
not each get their own round trip: they collapse into one follow-up refresh
carrying the latest configuration, so a burst costs at most the in-flight patch
plus one more. A patch that fails leaves the previously active configuration in
force.

## Reconnect Behavior

When the browser transport drops temporarily, the manager keeps the realtime
session active and attempts recovery with the latest effective config.

- recovery is attempted five times, after `500ms`, `1s`, `2s`, `4s`, and `5s`;
  exhausting them stops the session, sets the connection to `"error"`, and emits
  `realtime:error`
- `state.session.status` stays `"active"` during recovery
- `state.connection` switches back to `"connecting"` until recovery succeeds
- successful reconnects do not emit synthetic `realtime:session:start/end`
- `updateSession(...)` still updates the cached base config while reconnecting
- `sendMessage(...)`, `sendAudioChunk(...)`, and `interrupt()` reject while the
  connection is recovering
- `realtime:reconnect:attempt`, `realtime:reconnect:success`, and
  `realtime:reconnect:exhausted` are emitted for observability

## Send and Interrupt Contract

`sendMessage(...)` also rejects while a response is already in progress; the
app must call `interrupt()` first, because the transport allows one active
response at a time. This deliberately diverges from the cascade path, where
`Charivo.userSay(text)` is latest-wins: a newer call supersedes the in-flight
turn, aborts its in-flight HTTP request (when the LLM client honors the
optional signal — the remote client does), announces it with
`turn:cancelled`, and the superseded call resolves. The two contracts are intentionally
different — don't normalize them.

The two paths also have distinct interrupt entry points, and that split is
intentional too: `charivo.interrupt()` is the cascade counterpart — it aborts
the in-progress turn's LLM request and stops its TTS, without touching a
realtime session — while `realtimeManager.interrupt()` cuts off an in-progress
realtime response instead. A realtime app calls the realtime manager's own
`interrupt()`, not `charivo.interrupt()`.

## Observability

- `realtime:usage` is emitted whenever the transport reports usage on an
  assistant response. The payload is `{ usage, model?, responseId?, sessionId? }`,
  where `sessionId` is the current session's id.
- Pass a `logger` (`{ debug?, info?, warn?, error? }`) to
  `createRealtimeManager(client, { logger })` to receive internal manager
  logs. Log calls made during an active session automatically include
  `sessionId` in the log context.

## Provider Route

The browser posts a complete `RealtimeSessionRequest` — the selected adapter,
the transport, the effective session config (instructions, tools, voice), and an
SDP offer when the transport needs one. Forward the adapter, transport, and SDP
offer as they arrive: those are what the client resolved, and rebuilding them
server side would discard it.

The session config is different — it is untrusted input that decides what you
are billed for. Pin the cost-bearing fields (model, max output tokens,
transcription model) server side, allowlist the voice, and bound or validate
instructions and tools rather than passing them through. The route below is the
minimal shape; both shipped demo routes are the hardened version, and
[`examples/web/src/app/api/realtime/route.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/api/realtime/route.ts)
is worth reading before you deploy one.

The route also mints billable sessions, so gate it. Nothing in Charivo does that
for you — add your own auth and rate limiting where the placeholder sits below.

```ts
import {
  createOpenAIRealtimeProvider,
  type OpenAIRealtimeProviderConfig,
} from "@charivo/server/openai";
import type { RealtimeSessionRequest } from "@charivo/core";

export async function POST(request: Request) {
  // Your auth goes here. Without it, anyone who can reach this route can spend
  // your OpenAI budget.
  // if (!(await isAuthorized(request))) {
  //   return Response.json({ error: "unauthorized" }, { status: 401 });
  // }

  const body = (await request.json()) as Partial<RealtimeSessionRequest>;

  if (!body.transport || !body.session) {
    return Response.json(
      { error: "transport and session are required" },
      { status: 400 },
    );
  }

  if (body.session.provider !== "openai") {
    return Response.json(
      { error: `Unsupported realtime provider: ${body.session.provider}` },
      { status: 501 },
    );
  }

  const config: OpenAIRealtimeProviderConfig = {
    apiKey: process.env.OPENAI_API_KEY!,
  };
  const provider = createOpenAIRealtimeProvider(config);

  const bootstrap = await provider.createSession({
    adapter: body.adapter,
    transport: body.transport,
    session: body.session,
    sdpOffer: body.sdpOffer,
  });

  return Response.json(bootstrap);
}
```

That demo route is the same flow with full error handling and the pinning
described above. It still has no authentication or rate limiting — those remain
yours to add.

If `model` or `voice` are omitted from an OpenAI realtime session, the OpenAI
provider applies its OpenAI-specific defaults before calling OpenAI. Apps can
still pass those fields explicitly when they need deterministic provider
configuration.

For a no-server development setup, see
[OpenAI Agents SDK Transport](#openai-agents-sdk-transport).

## Alternatives

- Use the direct Agents transport package when you need to own the realtime transport client directly in the browser.
- Use the legacy low-level package only when you intentionally depend on the older `openai-webrtc` flow.
- Use turn-based [STT](./stt.md) and [TTS](./tts.md) when you do not need continuous live sessions.

## References

- [Realtime Package README](https://github.com/zeikar/charivo/blob/main/packages/realtime/README.md)
