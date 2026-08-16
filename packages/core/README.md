# @charivo/core

`@charivo/core` is the contract layer for the Charivo workspace.

It exports:

- `Charivo`: the top-level orchestrator
- shared domain types such as `Character`, `Message`, and realtime session types
- interface contracts for LLM, render, TTS, STT, and realtime managers
- the event contracts `CharivoEventBus` and `CharivoEventEmitter`: the render
  manager receives a bus via `setEventBus(...)`, while the TTS/STT/LLM/Realtime
  managers receive an emitter via `setEventEmitter(...)`; the concrete bus
  implementation is internal, and consumers subscribe via `charivo.on/off(...)`
- `createLipSyncAnalyzer`: the shared audio-analysis utility the TTS manager
  and realtime clients use to compute mouth-open RMS and emit
  `tts:lipsync:update`
- modality-neutral tool contracts (`ToolDefinition`, `ToolRegistration`, ...)
  plus the validation and execution helpers (`validateToolArguments`,
  `assertToolResultObject`, `createToolRegistry`, `withToolTimeout`,
  `snapshotToolResult`, `createToolFailureOutput`) shared by `@charivo/llm`
  and `@charivo/realtime`

The public API is factory-first: pluggable managers/clients/players/
transcribers/renderers are created via `create*` factories and consumed
through their interfaces; concrete implementation classes are not
exported. `Charivo`, the `CharivoError` taxonomy, and the OpenAI/OpenClaw
provider classes (`OpenAILLMProvider`, `OpenClawLLMProvider`,
`OpenAITTSProvider`, `OpenAISTTProvider`, `OpenAIRealtimeProvider`) are
the three exceptions, exported directly as concrete classes: `Charivo`
owns the instance lifecycle (wiring managers, the event bus, and
`dispose()`), so although `createCharivo()` is the preferred way in, the
class stays exported for wiring that happens after construction;
`CharivoError` is a taxonomy
checked via `isCharivoError`/`error.code`, not constructed; the
OpenAI/OpenClaw providers are exported because consumers rely on
`instanceof` checks and provider methods outside the narrow core
interface — a contract `packages/server/__tests__/barrel.test.ts` pins;
their factories are also browser-callable via `dangerouslyAllowBrowser`
for dev/testing, not a "Node-only" restriction.
Subclassing `Charivo` is not supported — extend via composition.

## Install

```bash
pnpm add @charivo/core
```

## Usage

```ts
import { createCharivo } from "@charivo/core";

const charivo = createCharivo({
  character: {
    id: "hiyori",
    name: "Hiyori",
    personality: "Cheerful and helpful assistant",
  },
});

charivo.on("message:received", ({ message }) => {
  console.log(message.content);
});
```

## `Charivo`

`createCharivo(options)` builds an instance with its managers already attached.
Every option is optional:

```ts
const charivo = createCharivo({
  renderer: renderManager,
  llm: llmManager,
  tts: ttsManager,
  stt: sttManager,
  realtime: realtimeManager,
  character,
});
```

Each option also accepts `null`, treated the same as omitting it, so a manager
that resolves conditionally can be passed through without a fallback.

It is exactly `new Charivo()` plus the matching `attach*` calls followed by
`setCharacter()`, and it returns an ordinary `Charivo` — supply what you have
up front and keep attaching later, as when swapping a provider at runtime.
Constructing the class directly still works and is not deprecated.

The `Charivo` instance wires managers together:

- `attachRenderer(renderManager)`
- `attachLLM(llmManager)`
- `attachTTS(ttsManager)`
- `attachSTT(sttManager)`
- `attachRealtime(realtimeManager)`
- `detachLLM()`
- `detachRenderer()`
- `setCharacter(character)`
- `userSay(text)`
- `dispose()`
- `clearHistory()`
- `getHistory()`
- `on(event, listener)`
- `off(event, listener)`

`detachRenderer()` disconnects the render manager's event-bus listeners and
releases any held expression, without destroying the manager, so it remains
reusable. Calling `attachRenderer(newManager)` automatically disconnects the
previously-attached manager before wiring the new one.

`userSay(text)` is **latest-wins**: a newer call supersedes the turn still in
flight, so only the newest turn goes on to speak. It still stops any TTS
playing from a previous turn before generating a response, so the new turn's
own audio/expression events can't be undone by the previous turn's speech
ending. A failure during that stop doesn't abort the turn — it's surfaced via
`tts:error`, like other non-fatal TTS failures during `userSay(text)`.

The superseded call **resolves**; it never rejects, and once superseded it
does no further work for that turn and emits no further events for it, beyond
finishing the bookkeeping of its own entry (see Ordering below) and reporting
the outcome of a tool handler that had already started: that handler's
`tool:result`/`tool:error` still fires, because it reports work that genuinely
happened, so `turn:cancelled` is not an event barrier. Projections still stop,
and no new tool work or request starts.
`turn:cancelled` (`{ userMessageId }`) fires exactly once for it, and
supersession by a newer `userSay(text)` is its only cause. What the superseded
turn leaves behind is its **user message**: it is retained no matter which
phase the cancellation landed in, always ordered ahead of the superseding
turn's own message, and from then on it is an ordinary history entry subject
to normal `maxHistoryTurns` eviction. Input the LLM manager refuses to store —
empty content, exactly as today — is never stored. The unspoken reply is
dropped.

A reply reaches history only at the **presentation boundary**: after its own
character message has rendered (immediately, when no renderer is attached) and
before playback would begin. It commits there even with no TTS manager
attached — the boundary is presentation, not playback. So a turn superseded
while generating, while emitting `message:received`/`character:speak`, or
while rendering its reply never commits that reply, while a reply that is
already speaking when the next turn arrives stays in history in full.
(Truncating it to what was actually heard needs word-level playback alignment
Charivo doesn't have; that's a follow-up, not a guarantee.)

Where the history writes happen: a live turn writes its own user message at
the LLM step — the point where it reads the attached manager and character,
exactly as today — so a turn that completes or fails without ever reaching an
attached manager and character writes nothing at all. A turn superseded before
that point has its message written by the **next** `userSay(text)`, in call
order, ahead of that turn's own message. `attachLLM(...)` and
`setCharacter(...)` write no history, so `getHistory()` does not change at
attachment, and `dispose()` discards whatever is still unwritten.

Ordering:

- History order is call order, at any reentrancy depth — including a turn
  started synchronously from inside a `message:sent` listener.
- The `message:sent` carrying an id always precedes any `turn:cancelled`
  carrying that id.
- A turn superseded during its own entry still emits its `message:sent`, still
  announces its predecessor's cancellation, and still keeps its user message:
  those steps run to completion before the turn checks whether it is still the
  live one.
- `turn:cancelled` is a per-turn fact, not an ordered log. A listener that
  starts a turn from inside an event can observe an inner turn's cancellation
  before an outer turn's; each superseded turn is still announced exactly once.
- `message:sent` is now emitted **before** the pre-turn TTS stop rather than
  after it. The stop targets the TTS manager attached when `userSay(text)` was
  called, so a `message:sent` listener that calls `attachTTS(...)` or
  `detachTTS()` does not change which audio is stopped — it governs that
  turn's playback only, exactly as before.

Failures on a **live** turn behave as they did, with one deliberate
divergence:

- A generation failure rejects and rolls the turn's user message back,
  restoring what that write evicted at the history bound (unless history has
  been written again meanwhile, which the rollback deliberately doesn't
  undo). It rolls back only the manager the turn actually wrote into, even if
  a different one was attached in the meantime.
- A failure before the LLM step — a rejected user-message render — has written
  nothing yet, so there is nothing to roll back.
- A **character-render failure now rejects without committing the reply**,
  where previously the reply was already in history by then. The turn's user
  message stays. This is the one intentional change on the failure paths.
- Playback failures stay non-fatal: `tts:error`, then resolve, with the
  committed reply left in history.
- A **superseded** turn never rolls back and never emits an error event on any
  of these paths.

A tool handler that has already started runs to completion, and cancellation
does not undo its side effects. What stops is new work. `Charivo` hands the
manager a cancellation predicate, and the built-in `@charivo/llm` manager
checks it in four places: before each further tool call, between a call's
`tool:call` emission and its handler, before each follow-up request, and on
every projected emission. A custom `LLMManager` should honor the same four
checkpoints, since only the manager can enforce them. That is also why
`tool:call` records an *attempted, dispatched* call, and can be the last event
for a call whose handler was skipped, while `tool:result`/`tool:error` report
a handler that actually ran. The superseded turn's in-flight LLM request is
abandoned but keeps running; request-level `AbortSignal` threading is a
follow-up. There is
no guard interval either — a stray duplicate send is indistinguishable from a
deliberate rapid correction, so debouncing belongs in the input layer.

Nothing else cancels a turn: `setCharacter(...)`, `attachLLM(...)`,
`detachLLM(...)`, `clearHistory()` and `dispose()` neither cancel an in-flight
turn nor move the point at which a turn reads the manager or the character.
Message validation is unchanged — `userSay("")` still emits `message:sent`,
still runs the pre-turn stop and renders the user message, and still rejects
with `CharivoStateError` from the LLM step (and still resolves when no manager
and character are attached) — and an empty assistant reply is still stored,
presented, and spoken exactly as before.

The realtime path deliberately keeps the opposite contract:
`RealtimeManager.sendMessage(...)` rejects while a response is in progress and
requires an explicit `interrupt()`, because the transport allows one active
response at a time. The divergence is intentional, not an inconsistency to
normalize.

The current render-manager contract is explicit: a `RenderManager` must expose
`setEventBus(eventBus)` and `disconnect()` so the core can connect and cleanly
tear down typed character, TTS, and realtime events without duck typing.

### `RenderManager` public methods

Beyond the event-bus contract, `RenderManager` exposes optional public methods
for driving avatar state from the app layer:

- `setLocalGaze(coords: GazeCoordinates): boolean` — drives local-presence gaze
  (e.g. webcam face tracking). Returns `false` (no-op) while AI gaze owns the
  avatar (the `avatar:gaze` suspend window is active) or when the renderer has
  no `lookAt`.

## Errors

Public methods throw typed errors exported from `@charivo/core`:

- `CharivoStateError`
- `CharivoTimeoutError`
- `CharivoTransportError`
- `CharivoProviderError`
- `CharivoDisposeError`

Prefer `isCharivoError(error)` or `error.code` checks over
`error.message.includes(...)`. Raw `instanceof CharivoError` is only
guaranteed to work within a single installed copy of `@charivo/core`;
`isCharivoError` also recognizes branded errors thrown by a duplicated copy.
Symbol brands never survive serialization. `error.code` survives
`JSON.stringify` (it is a plain enumerable property), but `structuredClone`
and worker `postMessage` drop custom `Error` properties entirely — send an
explicit `{ code, message }` envelope across those boundaries instead of
relying on the error object itself.

## Tool Contracts

`@charivo/core` owns a modality-neutral tool contract used by both
`@charivo/llm` (`LLMManager`) and `@charivo/realtime` (`RealtimeManager`), so a
tool built once (e.g. by `@charivo/avatar`) registers with either manager:

- `ToolDefinition`: `{ type: "function", name, description, parameters }`, a
  JSON Schema-shaped function definition
- `ToolContext`: `{ character?, callId?, state? }` passed to a handler;
  `state` (a `RealtimeState`) is present only for realtime sessions
- `ToolHandler`: `(args, context) => Promise<Record<string, unknown>>` — must
  resolve to a plain object; arrays and primitives are rejected by the runners
- `ToolRegistration`: `{ definition, handler, timeoutMs? }`
- `ToolResultProjector` / `ToolResultProjectorContext`: `({ name, output,
  callId?, emit }) => void`, run by a manager after a successful tool call so
  app code can turn tool output into Charivo events (e.g. `avatar:expression`)

Validation helpers, used by both managers before/after a handler runs:

- `validateToolArguments(definition, args, toolLabel?)`: throws a plain
  `Error` on the first schema violation. Enforces only required-key presence,
  `enum` membership, and each property's top-level `type` — nested schemas,
  `additionalProperties`, and numeric-length constraints are not validated.
- `assertToolResultObject(result, toolName, toolLabel?)`: throws a plain
  `Error` unless `result` is a plain object.

Execution helpers, shared so both managers run tools with the same guarantees:

- `createToolRegistry(): ToolRegistry`: name-keyed registry
  (`register` / `unregister` / `get` / `size` / `getDefinitions`).
  `getDefinitions()` deep-copies, so a provider cannot mutate a registered
  schema.
- `withToolTimeout(promise, timeoutMs, toolName, toolLabel?)`: rejects with
  `${toolLabel} "${toolName}" timed out after ${timeoutMs}ms` and always clears
  its timer.
- `snapshotToolResult(result, toolName, toolLabel?): ToolResultSnapshot`:
  serializes once and returns `{ serialized, snapshot }` — the string for the
  model's tool turn or the transport, and its parsed form for the `tool:result`
  event and the result projectors. Call it inside a runner's failure boundary
  so an unrepresentable result degrades to a failure output: `JSON.stringify`
  returns the value `undefined` (without throwing) for a result whose
  `toJSON()` yields `undefined`, and a `toJSON()` can also yield null, an
  array, or a primitive, so the parsed value is re-checked against the
  tool-result contract. Both tool runners use this, which is what makes a tool
  result mean the same thing across modalities.
- `createToolFailureOutput(error)`: the always-serializable
  `{ success: false, error }` output handed back to the model when a call fails.

### LLM Tool-Calling Contracts

- `LLMMessage`: role-discriminated union (`system`/`user`, `assistant` with
  optional `toolCalls`, or `tool` with a required `toolCallId`) so
  protocol-invalid combinations are unrepresentable for typed callers
- `LLMToolCall`: `{ id, name, arguments }`
- `LLMToolResponse`: `{ content, toolCalls? }`
- `LLMProvider.generateResponseWithTools?(messages, tools)`: optional
  tool-calling variant a provider implements alongside `generateResponse`
- `LLMClient.callWithTools?(messages, tools)`: optional tool-calling variant a
  client implements alongside `call`
- `LLMManager.registerTool?`, `unregisterTool?`, `getRegisteredTools?`,
  `setToolInstructions?`: optional manager methods for managing the tool
  registry and the tool-only system-prompt addendum

## Events

Important event names include:

- `message:sent`
- `message:received`
- `turn:cancelled`
- `character:speak`
- `tts:start`
- `tts:end`
- `tts:error`
- `tts:audio:start`
- `tts:audio:end`
- `tts:lipsync:update`
- `stt:start`
- `stt:partial`
- `stt:stop`
- `stt:error`
- `llm:error`
- `tool:call`
- `tool:result`
- `tool:error`
- `realtime:session:start`
- `realtime:session:end`
- `realtime:state`
- `realtime:user:transcript`
- `realtime:assistant:start`
- `realtime:assistant:delta`
- `realtime:assistant:done`
- `realtime:usage`
- `avatar:expression`
- `avatar:motion`
- `avatar:gaze`
- `realtime:error`

`avatar:gaze` (a bare `GazeCoordinates`) and `realtime:usage` (a flat
`RealtimeUsageEvent`) intentionally use flat payloads rather than wrapper
objects.

The event bus isolates each listener: one that throws is reported via
`console.error` and does not stop the listeners queued behind it, so `emit`
never throws into its caller.
