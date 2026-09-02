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
@charivo/server/openai or @charivo/server/gemini
```

This is the current production-oriented browser path. The browser calls your
route, receives an adapter-aware bootstrap, and connects through the default
remote adapter registry. The session config's `provider` and `transport` pick
the adapter on both ends: `provider: "openai"` with the default `webrtc`
transport runs OpenAI Realtime through the OpenAI Agents WebRTC adapter, and
`provider: "gemini"` with `transport: "websocket"` runs Gemini Live through the
Gemini Live WebSocket adapter. Your route dispatches to the matching server
provider on the same field.

Add `@charivo/avatar` (a separate install) if you want its avatar
expression/motion/gaze tools and result projector, as used in the Basic Setup
example below — [Avatar Control](./avatar.md) covers the catalog those tools are
built from. The same tools also work with `@charivo/llm`'s `LLMManager`; see
[LLM — Avatar Tool Calling](./llm.md#avatar-tool-calling).

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
// For Gemini Live instead: { provider: "gemini", transport: "websocket" }.

await manager.prepareAudio(sessionConfig);
await manager.startSession(sessionConfig);
```

`gpt-realtime-2.1-mini` is the default OpenAI realtime model. The full
`gpt-realtime-2.1` is available but meaningfully more expensive — consult
[OpenAI's pricing page](https://developers.openai.com/api/docs/pricing) before
switching. On Gemini Live the default is `gemini-3.1-flash-live-preview`, the
model the transport was measured against; `@charivo/server/gemini` accepts only
the models on its allow-list, so an unknown `model` fails at your route rather
than at Google.

### Input Audio Transcription

`RealtimeSessionConfig.inputAudioTranscription` controls whether the provider
transcribes the user's microphone input. It is off unless asked, on both
providers, and `enabled` is the switch:

- unset, `{}`, or `{ enabled: false }` — off
- `{ enabled: true }` — on, with the provider's default transcription model
  (`gpt-4o-mini-transcribe` on OpenAI)
- `{ model }` — on with that model, on OpenAI; Gemini Live offers no choice of
  model, and `@charivo/server/gemini` rejects the field

On OpenAI the block lands under `audio.input.transcription` on the wire (OpenAI
Realtime GA shape), and the `updateSession` calls below switch it mid-session.
On Gemini Live the session is fixed at connect time (see
[Session Updates](#session-updates)), so decide before `startSession(...)`.
Transcripts there arrive whole — one `realtime:user:transcript` per utterance,
ahead of the reply it prompted. Output transcription is always requested on
Gemini: on a native-audio model it is the only source of assistant text, and it
is what `realtime:assistant:delta` carries, in fragments. Either way input
transcription is billed, which is why nothing is transcribed until you ask.

```ts
// On, with the provider default — the same shape on either provider.
await manager.startSession({
  provider: "gemini",
  transport: "websocket",
  inputAudioTranscription: { enabled: true },
});

// Or name the model (OpenAI only).
await manager.startSession({
  provider: "openai",
  inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
});

// Switch models mid-session (OpenAI only).
await manager.updateSession({
  inputAudioTranscription: { model: "gpt-4o-transcribe" },
});

// Turn it off (useful when your UI never shows user transcripts).
await manager.updateSession({
  inputAudioTranscription: { enabled: false },
});
```

Model strings pass through to OpenAI without local validation, so unknown
values surface as upstream errors. Known options today include `whisper-1`,
`gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, and `gpt-realtime-whisper` (the
one the [Provider Route](#provider-route) example pins).

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
defaults. Provider-specific model and voice fallbacks live in each
transport/provider pair, not in the provider-agnostic manager helper — and a
voice id is provider-specific too: `@charivo/server/gemini` replaces a voice
that is not one of Google's prebuilt names (`Kore`, `Puck`, ...) with its
default rather than failing, so a character carrying an OpenAI voice id speaks
as `Kore` on Gemini.

## Client Choices

### Remote

- `@charivo/realtime/remote`
- the default recommended in [Recommended Stack](#recommended-stack): it runs
  through your own server route, so no key reaches the browser
- resolves a browser transport adapter from its registry by the session's
  `provider` and `transport`: `openai` + `webrtc` (the default transport) is the
  OpenAI Agents WebRTC adapter, `gemini` + `websocket` is the Gemini Live
  adapter, and any other pair rejects with `CharivoStateError` before a request
  is made

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

### Gemini Live Transport

- `@charivo/realtime/gemini`
- WebSocket transport for the Gemini Live API, what the remote client resolves
  for `provider: "gemini"` with `transport: "websocket"`
- takes `apiEndpoint` or `sessionBootstrap` and never an API key: unlike the
  Agents transport there is no `apiKey` shortcut, so every session starts from
  a bootstrap your own code supplies — normally your route, via the remote
  client
- captures the microphone itself (16 kHz PCM, echo cancellation on) and plays
  the model's 24 kHz PCM through its own Web Audio scheduler, with a tap feeding
  lip-sync; `sendAudioChunk(...)` is not needed

Its design follows the measurements in
[`tests/gemini-live-smoke/README.md`](https://github.com/zeikar/charivo/blob/main/tests/gemini-live-smoke/README.md),
and two of them shape what an app sees:

- **Barge-in at the very start of a reply is dropped.** On macOS Safari, the
  echo canceller was measured leaking the character's own voice back to the
  model for the first ~0.5 s after it starts speaking, and the model killed its
  own turn there twice before the canceller converged. So the transport holds
  microphone frames back for the first 700 ms after each reply becomes audible,
  until the session has banked 700 ms of audible playback and a turn then ends
  without a server-side interruption; the gate re-arms after a reconnect. It
  runs on every browser, and the number was measured on one machine —
  re-measure before trusting it elsewhere.
- **`interrupt()` never reaches the wire.** The Live API has no message that
  cancels a generation, so the transport silences what it has scheduled and
  discards the rest of that turn as it arrives; see
  [Send and Interrupt Contract](#send-and-interrupt-contract).

Session resumption, `goAway` handover, context-window compression, and
mid-session `updateSession(...)` are not implemented. Nor are two things the
OpenAI transports do: pausing the lip-sync analyzer across visibility/pagehide
and refreshing the microphone on `devicechange`.

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

`registerTool(...)` / `unregisterTool(...)` update the registry immediately.
Nothing is sent while the session is idle — the next `startSession(...)` picks
the registry up. On a live OpenAI session each one patches the active session
so the model sees the new tool surface without a reconnect; a change made while
a response is in flight is deferred rather than applied mid-response, and
several deferred changes collapse into a single refresh once that response
completes, so registering a batch of tools costs one session patch, not one per
tool.

Both methods return `void` and the refresh is fire-and-forget: if the provider
rejects the patch, the failure surfaces as `realtime:error` rather than as a
rejected call, so watch that event instead of awaiting these. On a live Gemini
Live session the patch is always rejected — the session is fixed when its token
is minted (see [Session Updates](#session-updates)) — so the model keeps the
tool surface it started with. Register tools before `startSession(...)` there.

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

On OpenAI Realtime, send completion can precede playback completion by a wide
margin, and only the output-buffer events describe playback itself:

| Event | Meaning | Ends audio output? |
| --- | --- | --- |
| `response.audio.done`, `response.output_audio.done` | the server finished SENDING audio; the browser is still playing what it buffered | no |
| `output_audio_buffer.stopped` | playback ran to natural completion | yes |
| `output_audio_buffer.cleared` | an interruption discarded the buffer | yes |

Both OpenAI WebRTC transports report the end from the output-buffer events. Note
that the OpenAI Agents SDK raises `audio_stopped` on
`response.output_audio.done`, so that SDK event is a send completion despite its
name, and its `audio_interrupted` is emitted only by the SDK's WebSocket
transport — never over WebRTC.

Gemini Live has no output-buffer event, and the transport plays the audio
itself, so the end is decided from two facts it holds — and it needs both:

| Signal | Meaning | Ends audio output? |
| --- | --- | --- |
| `turnComplete` | the server closed the turn. It streams audio far faster than real time, then holds this frame until the moment the audio *would* finish — measured within ~30 ms of first chunk plus duration, and 3 ms before the last buffer's real end. That is a server clock, not your speakers, so a stalled network makes it early | only once the scheduler has drained |
| scheduler drain | every buffer the transport scheduled has finished. It also fires ~3 ms into a turn, when the opening chunk ends before its successor arrives | only once `turnComplete` has arrived |
| `interrupted` | server VAD cut the turn; the scheduled audio is flushed | yes |

Whichever of drain and `turnComplete` lands second fires `tts:audio:end`. Both
orderings were observed on real hardware, each with exactly one audio start/end
pair.

No timer or audio-level heuristic stands in for those signals. A guessed end
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

All three built-in transports honour it for a response the wire proves is in
flight when `interrupt()` runs. On OpenAI that is any acknowledged response,
whether client-requested or created by server VAD, plus — on the low-level
transport — a client-requested response interrupted before its acknowledgement,
across repeated interrupt-and-replace cycles. On Gemini Live it is a model turn
whose content has started arriving and whose `turnComplete` has not; nothing
can be sent to cancel it, so the transport drops the rest of the turn as it
streams in, until the server closes it. That turn's assistant lifecycle events
(`assistant.response.started`, `assistant.text.delta`,
`assistant.response.completed`) are dropped while the suppression holds. Tool
events stay live across an interrupt by design, and audio events keep reporting
real playback.

> **Known gap.** Because the built-in transports condemn only a response the
> wire proves they are interrupting, and the OpenAI ones de-arm on an unrelated
> failure, some windows stay uncovered. That is a deliberate scope limit, not a
> fixed constraint: closing them needs either an adapter-owned send path or turn
> identity on the lifecycle events.
>
> - Agents transport: an interrupt issued before the turn's first server event.
>   The SDK sends no `response.cancel` there, so nothing marks the turn — which
>   also covers a replacement queued behind a condemned turn and interrupted
>   before it starts.
> - Both OpenAI transports: a tool call resolving across an interrupt. Its
>   follow-up response can be credited to the replacement, and on the agents
>   transport the SDK can merge the two into a single response.
> - Both OpenAI transports: a server-VAD turn interrupted before its
>   acknowledgement.
> - Both OpenAI transports: a transport error arriving while a condemned
>   response is still outstanding. Suppression is dropped there on purpose —
>   staying armed after an unknown failure risks stranding the send lock — so
>   that response's late completion reports as genuine and can release a later
>   turn's lock.
> - Gemini transport: an interrupt issued before the turn's first
>   `serverContent` frame. Nothing is open to condemn, so the turn's later
>   events report as genuine. And because a condemned turn keeps generating
>   server side until its own `turnComplete`, its tool calls are still
>   dispatched, executed, and answered.
>
> In those windows, interrupting and immediately sending a replacement can leave
> `awaitingResponse` reporting `false` while that replacement is still pending.

### Asking whether the character is still talking

`RealtimeState.audioPlaying` answers that; `state.response.status` does not.

On OpenAI the response completes when the provider finishes sending, so it
reads `"completed"` for the whole tail of every turn while the character is
still audible. On Gemini Live it completes at `turnComplete`, which the server
paces to the audio's duration — milliseconds from the real end on a healthy
connection, and early on a stalled one, because it is a clock rather than an
observation of playback. Anything gated on it — a barge-in, a "stop" control, a
speaking indicator — is wrong for that window and looks right until someone
cuts in near the end of a reply.

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

Gemini Live cannot be patched in place. The session is fixed when
`@charivo/server/gemini` mints its token: the token's `bidiGenerateContentSetup`
*replaces* the setup the browser sends rather than merging with it (measured — a
token pinning only the model opened a session that closed on defaults the
client never asked for), and the Live API has no `session.update` equivalent.
So the transport rejects the patch instead of pretending to apply it: the call
rejects with a `CharivoTransportError`, `realtime:error` carries the same error,
and the session stays live on the configuration it started with. To change
anything — character, instructions, tools, voice — stop the session and start a
new one. `registerTool(...)` / `unregisterTool(...)` on a live Gemini session
hit the same refusal.

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

On Gemini Live every attempt goes back through your route: the ephemeral token
is minted `uses: 1`, and replaying one closes the socket with `1011` (measured),
so a reconnect re-mints rather than reusing the cached bootstrap. What comes
back is a fresh Live session, not a resumed one — the transport does nothing
with the `sessionResumptionUpdate` handles the server sends (it could not spend
one anyway, since the session config lives in the token) and does not act on
`goAway`; the close that follows drives this same recovery. The turn in flight
and any unanswered tool calls are dropped with the old socket, so a tool
handler that finishes after the reconnect gets a rejection from its result
send, and the microphone gate described under
[Gemini Live Transport](#gemini-live-transport) re-arms. Every unexpected
socket close reports `cause: "connection-failed"`.

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

What `realtimeManager.interrupt()` does on the wire depends on the provider.
The OpenAI transports cancel the response on the server. Gemini Live has no
client message that cancels a generation, so there the interrupt is entirely
local: the transport flushes what it has scheduled, ends audio output at once,
and condemns the turn so that its remaining audio, text, and completion are
dropped as they keep arriving. The server runs that turn to its own
`turnComplete` regardless, and that frame is what lifts the condemnation —
measured: interrupting mid-reply reported no completion for the killed turn,
and the next prompt completed normally.

## Observability

- `realtime:usage` is emitted whenever the transport reports usage on an
  assistant response. The payload is `{ usage, model?, responseId?, sessionId? }`,
  where `sessionId` is the current session's id. On Gemini Live `usage` is the
  turn's last `usageMetadata` frame, which breaks tokens down per modality
  (`promptTokensDetails` / `responseTokensDetails`, `TEXT` vs `AUDIO`), and
  `model` / `responseId` are absent; the audio prompt count grows turn over
  turn because input audio stays in the session's context.
- Pass a `logger` (`{ debug?, info?, warn?, error? }`) to
  `createRealtimeManager(client, { logger })` to receive internal manager
  logs. Log calls made during an active session automatically include
  `sessionId` in the log context.

## Provider Route

The browser posts a complete `RealtimeSessionRequest` — the selected adapter,
the transport, the effective session config (instructions, tools, voice), and an
SDP offer when the transport needs one. Forward the adapter, transport, and SDP
offer as they arrive: those are what the client resolved, and rebuilding them
server side would discard it. `session.provider` says which server provider to
dispatch to — `createOpenAIRealtimeProvider` from `@charivo/server/openai` or
`createGeminiRealtimeProvider` from `@charivo/server/gemini` — and each one
refuses a request naming the other provider.

The session config is different — it is untrusted input that decides what you
are billed for. Pin the cost-bearing fields (model, max output tokens,
transcription model) server side, allowlist the voice, and bound instructions
and tools rather than passing them through, as the builders below do.
Both shipped demo routes carry the fuller version of that check, and
[`examples/web/src/app/api/realtime/route.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/api/realtime/route.ts)
is worth reading before you deploy one.

The route also mints billable sessions, so gate it. Nothing in Charivo does that
for you — add your own auth and rate limiting where the placeholder sits below.

```ts
import { createOpenAIRealtimeProvider } from "@charivo/server/openai";
import { createGeminiRealtimeProvider } from "@charivo/server/gemini";
import type {
  RealtimeProvider,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";

const OPENAI_MODEL = "gpt-realtime-2.1-mini";
const OPENAI_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";
const OPENAI_VOICES = new Set(["marin", "cedar"]);
const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const MAX_OUTPUT_TOKENS = 1024;
const MAX_INSTRUCTION_CHARS = 4000;
const MAX_TOOLS = 16;
const MAX_TOOL_BYTES = 16_000;

// Keep what the client resolved that costs nothing, bounded. Anything not
// matched here is simply dropped.
function boundSharedInput(
  requested: RealtimeSessionConfig,
): Pick<RealtimeSessionConfig, "instructions" | "tools"> {
  return {
    ...(typeof requested.instructions === "string" &&
    requested.instructions.length <= MAX_INSTRUCTION_CHARS
      ? { instructions: requested.instructions }
      : {}),
    // Count and size: a short array can still carry huge schemas. UTF-8 bytes,
    // not `.length` — a non-ASCII schema is bigger on the wire than its
    // UTF-16 code-unit count suggests.
    ...(Array.isArray(requested.tools) &&
    requested.tools.length <= MAX_TOOLS &&
    new TextEncoder().encode(JSON.stringify(requested.tools)).length <=
      MAX_TOOL_BYTES
      ? { tools: requested.tools }
      : {}),
  };
}

// Pin what you are billed for, per provider.
function buildOpenAISessionConfig(
  requested: RealtimeSessionConfig,
): RealtimeSessionConfig {
  return {
    provider: "openai",
    model: OPENAI_MODEL,
    maxTokens: MAX_OUTPUT_TOKENS,
    ...boundSharedInput(requested),
    ...(requested.voice && OPENAI_VOICES.has(requested.voice)
      ? { voice: requested.voice }
      : {}),
    // Honor the request to transcribe, but on your model, not theirs. A block
    // without `enabled` is a request too — the provider treats it as on.
    ...(requested.inputAudioTranscription &&
    requested.inputAudioTranscription.enabled !== false
      ? {
          inputAudioTranscription: {
            enabled: true,
            model: OPENAI_TRANSCRIPTION_MODEL,
          },
        }
      : {}),
  };
}

function buildGeminiSessionConfig(
  requested: RealtimeSessionConfig,
): RealtimeSessionConfig {
  // No voice and no transcription model: the Gemini provider allowlists voices
  // itself and rejects a transcription model. Add
  // `inputAudioTranscription: { enabled: true }` here to turn transcription on.
  return {
    provider: "gemini",
    model: GEMINI_MODEL,
    maxTokens: MAX_OUTPUT_TOKENS,
    ...boundSharedInput(requested),
  };
}

export async function POST(request: Request) {
  // Your auth goes here. Without it, anyone who can reach this route can spend
  // your provider budget.
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

  let provider: RealtimeProvider;
  let session: RealtimeSessionConfig;

  switch (body.session.provider) {
    case "openai":
      provider = createOpenAIRealtimeProvider({
        apiKey: process.env.OPENAI_API_KEY!,
      });
      session = buildOpenAISessionConfig(body.session);
      break;
    case "gemini":
      provider = createGeminiRealtimeProvider({
        apiKey: process.env.GEMINI_API_KEY!,
      });
      session = buildGeminiSessionConfig(body.session);
      break;
    default:
      return Response.json(
        { error: `Unsupported realtime provider: ${body.session.provider}` },
        { status: 501 },
      );
  }

  const bootstrap = await provider.createSession({
    adapter: body.adapter,
    transport: body.transport,
    session,
    sdpOffer: body.sdpOffer,
  });

  return Response.json(bootstrap);
}
```

That demo route is the same flow with full error handling and a stricter
version of the same pinning. It still has no authentication or rate limiting —
those remain yours to add.

Each provider fills in what the route leaves out. If `model` or `voice` are
omitted, the OpenAI provider applies its OpenAI defaults, and the Gemini
provider applies `gemini-3.1-flash-live-preview` and the `Kore` voice — but
only from its own allow-lists: a model it does not know is rejected, and a
voice it does not know falls back to the default silently. Apps can still pass
those fields explicitly when they need deterministic provider configuration.

The Gemini bootstrap is `{ adapter, transport: "websocket", url, token }`, and
the token is where the session lives. Google's `bidiGenerateContentSetup`
*replaces* the browser's setup frame instead of validating it, and a token
minted without one opens a session for any model the holder names, on your
bill — both measured. So `createGeminiRealtimeProvider` builds the entire
session config into the token at mint time — model, voice, instructions, tools,
transcription, `maxTokens` — with `uses: 1`, and sends your API key in the
`x-goog-api-key` header rather than the URL. The browser's own setup frame
carries nothing the token did not already fix, and a replayed token closes the
socket with `1011`, which is why a reconnect mints again. The provider also
refuses what the Live API cannot express instead of coercing it: a `transport`
other than `websocket`, a `toolChoice` of `none` or `required`, and an
`inputAudioTranscription.model`.

For a no-server development setup on OpenAI, see
[OpenAI Agents SDK Transport](#openai-agents-sdk-transport).

## Alternatives

- Use the direct Agents transport package when you need to own the realtime transport client directly in the browser.
- Use the legacy low-level package only when you intentionally depend on the older `openai-webrtc` flow.
- Use turn-based [STT](./stt.md) and [TTS](./tts.md) when you do not need continuous live sessions.

## References

- [Realtime Package README](https://github.com/zeikar/charivo/blob/main/packages/realtime/README.md)
- [Gemini Live measured record](https://github.com/zeikar/charivo/blob/main/tests/gemini-live-smoke/README.md)
  — the live-API measurements the Gemini transport and provider are built on
