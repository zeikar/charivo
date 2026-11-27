# @charivo/core

`@charivo/core` is the contract layer for the Charivo workspace.

It exports:

- `Charivo`: the top-level orchestrator
- shared domain types such as `Character`, `Message` (`user`, `character`,
  `system`, `direction`, `event`), the typed brain input `BrainInput` with its
  `BrainRespond` / `BrainHistoryPolicy` policies, and realtime session types
- the body API (`perform`, `react`, `interrupt`, `getFloor`, `setAffectMap`)
  and the brain port (`ConversationBrain`, `BrainTurn`, `BrainTurnResult`)
- interface contracts for LLM, render, TTS, STT, and realtime managers
- the event contracts `CharivoEventBus` and `CharivoEventEmitter`: the render
  manager receives a bus via `setEventBus(...)`, while the TTS/STT/LLM/Realtime
  managers receive an emitter via `setEventEmitter(...)`; the concrete bus
  implementation is internal, and consumers subscribe via `charivo.on/off(...)`
- `createLipSyncAnalyzer`: the shared audio-analysis utility the TTS manager
  and realtime clients use to emit `tts:lipsync:update`. Its `rms` is already
  the final 0..1 mouth opening: the signal's RMS, normalized against a slowly
  decaying recent peak, gated below about -50 dBFS, and passed through a fast
  attack / quicker release envelope so the mouth closes between syllables.
  Renderers apply it without further gain
- `fetchWithTimeout` (with `DEFAULT_FETCH_TIMEOUT_MS`): the shared `fetch`
  wrapper that enforces a timeout, layers an optional external `AbortSignal`
  on top, and classifies the failure into the `CharivoError` taxonomy; the
  llm/tts/stt/realtime/server remotes share it
- modality-neutral tool contracts (`ToolDefinition`, `ToolRegistration`, ...)
  plus the validation and execution helpers (`validateToolArguments`,
  `assertToolResultObject`, `createToolRegistry`, `withToolTimeout`,
  `snapshotToolResult`, `createToolFailureOutput`) shared by `@charivo/llm`
  and `@charivo/realtime`

The public API is factory-first: pluggable managers/clients/players/
transcribers/renderers are created via `create*` factories and consumed
through their interfaces; concrete implementation classes are not
exported. `Charivo`, the `CharivoError` taxonomy, and the server provider
classes (`OpenAILLMProvider`, `OpenClawLLMProvider`, `OpenAITTSProvider`,
`OpenAISTTProvider`, `OpenAIRealtimeProvider`, `GeminiRealtimeProvider`) are
the three exceptions, exported directly as concrete classes (the providers
from `@charivo/server/*`): `Charivo`
owns the instance lifecycle (wiring managers, the event bus, and
`dispose()`), so although `createCharivo()` is the preferred way in, the
class stays exported for wiring that happens after construction;
`CharivoError` is a taxonomy
checked via `isCharivoError`/`error.code`, not constructed; the
providers are exported because consumers rely on
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
import { createCascadeBrain } from "@charivo/llm";

const charivo = createCharivo({
  brain: createCascadeBrain(llmManager),
  tts: ttsManager,
  renderer: renderManager,
  character: {
    id: "hiyori",
    name: "Hiyori",
    personality: "Cheerful and helpful assistant",
  },
});

charivo.on("message:received", ({ message }) => {
  console.log(message.content);
});

const turn = charivo.getBrain()!.submit({ kind: "user", text: "Hello" });
const result = await turn.done; // { status: "completed", text, heardText }
```

`@charivo/core` imports nothing from `@charivo/llm`: the brain is any
`ConversationBrain` (see [Brain port](#brain-port)), and the cascade brain is
one implementation. Without a brain, `Charivo` is only a body: `perform()` and
`react()` still work.

## `Charivo`

`createCharivo(options)` builds an instance with its managers already attached.
Every option is optional:

```ts
const charivo = createCharivo({
  renderer: renderManager,
  brain: createCascadeBrain(llmManager),
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

The `Charivo` instance wires managers together and is the character's body:

- `attachRenderer(renderManager)` / `detachRenderer()` / `getRenderManager()`
- `attachTTS(ttsManager)` / `detachTTS()` / `getTTSManager()`
- `attachSTT(sttManager)` / `detachSTT()` / `getSTTManager()`
- `attachRealtime(realtimeManager)` / `detachRealtime()` /
  `isRealtimeModeEnabled()` / `getRealtimeManager()`
- `attachBrain(brain)` / `detachBrain()` / `getBrain()`
- `getCurrentCharacter()` / `setCharacter(character)`
- `perform(request)`, `react(request)`, `interrupt()`, `getFloor()` and
  `setAffectMap(map | null)`: the [body API](#body-api)
- `dispose()`
- `on(event, listener)` / `off(event, listener)` / `emit(event, payload)`

`Charivo` holds no LLM manager: generating a reply is the brain's job, and
history lives in the brain (`brain.getHistory()`, `brain.clearHistory()`).

`detachRenderer()` disconnects the render manager's event-bus listeners and
releases any held expression, without destroying the manager, so it remains
reusable. Calling `attachRenderer(newManager)` automatically disconnects the
previously-attached manager before wiring the new one.

`dispose()` refuses `perform()` and `attachRealtime()` with
`CharivoStateError` from the call until its teardown is done, and overlapping
calls share one promise. It first awaits `brain.dispose?.()` and detaches the
brain, so the brain's live turn is cancelled before the floor is torn down. It
then cancels the floor's performance and, for each speech whose stop is
unconfirmed, joins the stop in progress or makes one stop attempt on the
manager that speech is on, and runs the existing teardown. A stop issued on a
manager during the teardown by anyone (the brain's cleanup cancelling its turn,
an `interrupt()`) counts as dispose's attempt for that manager; if it has
already failed when the teardown reaches the manager, `dispose()` retries it
once. A failure goes into the first-error report as a `CharivoDisposeError`
whose `cause` is the original error, and teardown continues. The promise
settles a few microtasks after the teardown is done, and the instance can be
reused from then.

### Body API

The body is what a character does: show a line, speak it, react with the face.
It is independent of what decides the line. A brain, a script and a game event
all drive the same `perform()`.

**The floor.** At most one performance holds the floor, and `getFloor()` says
who holds playback: `{ state: "idle" }`, `{ state: "speaking", performanceId,
origin }` or `{ state: "realtime" }` (see [Realtime](#realtime)).
`floor:changed { floor }` fires whenever that value changes.

**`perform({ text, origin?, whenBusy?, affect? })`** takes the floor and returns
a `PerformanceHandle` (named so because `Performance` is a DOM global):
`{ id, started, done, result, cancel() }`.

- `text` is a string, performed as given (the empty string included), or an
  async iterable of chunks.
- `origin` names who asked and defaults to `"app"`; the cascade brain uses
  `"cascade"`.
- `whenBusy` is `"interrupt"` (default), which cancels the holder and takes the
  floor (the latest call wins, even from inside an event listener), or
  `"reject"`.
- `perform()` throws `CharivoStateError` synchronously when `text` is neither a
  string nor an async iterable, when realtime holds playback, from a
  `dispose()` call until its teardown is done, or when the floor is held and
  `whenBusy` is `"reject"`. Otherwise the floor is yours before it returns.
- `started` resolves `true` once the line (a stream's first segment) has
  rendered, or reached that step with no renderer attached, and `false` when
  the performance ended first. It never resolves inside the `perform()` call,
  and a continuation you attach to it runs before any speech. `started` and
  `done` never reject.
- `done` resolves with `{ status: "completed" | "cancelled" | "failed", text,
  heardText?, failedAt?, error? }`. `handle.result` is the same value, readable
  synchronously from the moment the performance ends.
- `cancel()` frees the floor and settles `done` as `cancelled` at once; when a
  `speak()` is in flight it also issues one `stop()` on that TTS manager and
  rejects with the typed provider error if the stop fails. A repeated call
  returns the first call's outcome.

Events, in order: `floor:changed`, `performance:start { performanceId, origin,
voiced, text?, affectResolved }`, the affect events, the run, `performance:end {
performanceId, origin, status, heardText?, error? }`, `floor:changed`. Every
start has exactly one end. Events are delivered one at a time in the order they
were produced, and one produced from inside a listener is delivered after that
dispatch reached every listener; state (`getFloor()`, `done`) is never deferred.
A performance's run begins only once its own `performance:start` has been
delivered, so a start listener can cancel it before anything is shown or
spoken. A performance displaced before its start was produced emits neither
start nor end and settles `started: false`, `done: { status: "cancelled",
heardText: "" }`.

`voiced` is whether a TTS manager was attached when the floor was taken; that
manager speaks the whole performance.

```ts
// A string: rendered as a character message (id = performance id), then
// spoken with the character's voice.
const line = charivo.perform({
  text: "Welcome back!",
  affect: { expression: { affect: "joy", intensity: 0.8 } },
});
if (await line.started) {
  console.log("on screen");
}
const { status, heardText } = await line.done;
```

A string run renders the line, then waits for any stop in progress and calls
`speak(text, options)`. A render failure ends it `failed` with `failedAt:
"render"` and nothing is spoken; a TTS failure ends it `failed` with `failedAt:
"tts"`, and a performance that finds cancelled speech still unsettled ends
`failed` at `tts` without speaking.

```ts
// A stream: cut into sentences, each segment rendered as its own message
// (id `<performanceId>:<index>`) and spoken before the next chunk is read.
charivo.on("performance:segment", ({ index, text }) => {
  console.log(index, text);
});
const stream = charivo.perform({ text: tokenStream, origin: "llm" });
```

For a stream the floor is taken and `performance:start` (no `text`) fires at
the call, before the first chunk is read. Each speakable segment is announced
with `performance:segment { performanceId, origin, index, text }`, rendered,
then spoken, and the next chunk is read only when those segments have finished,
so no text queues up behind the voice. `started` resolves `true` once the first
segment has rendered. `text` in the result is everything read from the iterator
and `heardText` is the part up to the end of the last segment whose speech
finished (its render, when unvoiced). An iterator that rejects ends the
performance `failed` with `error` and no `failedAt`; a render or TTS failure on
a segment ends it `failed` with that `failedAt`, drops the segments behind it
and closes the stream. A stream with no speakable segment ends `completed` with
`started: false`. Leaving the loop early abandons a pending `next()` and calls
the iterator's `return()` once without awaiting it, so cancellation never waits
for the iterator; a throw from `return()` is reported with `console.warn`.

**`heardText`** is the full text on `completed`. On a cancelled string it is
`""` only when playback demonstrably had not begun (`speak()` not yet called, or
called on a manager that takes an event emitter and no `tts:audio:start` has
been heard since); in every other case it is omitted, so a manager that cannot
report audio start never yields `""` once it was asked to speak.

**Cancellation and unsettled speech.** The logical half of a cancel is
synchronous. The transport half is one `stop()` on the TTS manager the
performance speaks on. Until a stop on that manager succeeds, that speech is
*unsettled*, whoever holds the floor: no `speak()` is issued, and
`attachRealtime()` refuses. A stop that rejects leaves it unsettled (the old
voice may still be audible) and is reported to whoever waits, or with
`console.error`; a later stop that succeeds settles it.

**`interrupt()`** is speech only: it cancels the floor's performance and touches
no brain turn (cancel the brain's turn with `turn.cancel()` or
`brain.interrupt()`). It retries the stop of unsettled speech and, when the
cancel supplied no stop (no holder, an unvoiced one, or one not yet speaking),
also stops the attached TTS manager, joining a stop already in progress. No
manager gets two concurrent stops. It resolves when those stops have settled
and rejects with the typed provider error of the first that failed. It is
idle-safe with nothing playing. It does not delegate to the realtime manager,
so a realtime app uses `getRealtimeManager()?.interrupt()`.

**Affect.** A cue is `{ expression?, motion? }`. A string `expression` is an
expression id, used as is. `{ affect, intensity? }` resolves through the map
set with `setAffectMap()`; no map, an unknown label or no qualifying entry
resolves to nothing. `motion` is the cue's own, else the chosen entry's. An
`AffectMap` is a record from affect label to one `AffectMapEntry` or a list of
them; an entry has `expressionId?`, `motion?` and `minIntensity?` (default 0).
Intensity defaults to 0.5 and is clamped to 0..1, and the entry with the
highest `minIntensity` not above it wins. Set the map again when the model
changes; `setAffectMap(null)` clears it.

```ts
charivo.setAffectMap({
  joy: [
    { expressionId: "Smile" },
    { expressionId: "Laugh", motion: { group: "TapBody", index: 1 }, minIntensity: 0.7 },
  ],
});
```

A performance's affect is emitted right after `performance:start` as
`avatar:expression` from source `"performance"` at `explicit` priority, held for
the performance when voiced and with no hold when not, and a muted
`avatar:motion` (`muteSound: true`) at `explicit`. `performance:start`'s
`affectResolved` is `true` when the cue resolved to an expression id or a
motion; whether the loaded model has that id stays `RenderManager`'s check. An
app that wants a clip's own audio emits `avatar:motion` itself.

**`react({ source, hold, priority?, expression?, motion?, gaze?, critical? })`**
never takes the floor. It emits `avatar:expression` and `avatar:gaze` (both with
the request's `source`, `hold` and `priority`, default `"reflex"`, and a
`claimId` fresh for this reaction) and a muted `avatar:motion` for whatever the
request resolved to, and returns `{ resolved, release }`. `release()` emits,
once, an `avatar:release` carrying that `claimId` for each held channel it
claimed, so an old handle never clears a newer claim from the same source, and
a claim the renderer ignored never takes a handle away from the one still
showing. `critical` also cancels the floor's performance, whether or not the
cue resolved; it is allowed with priority `reflex` only, and any other priority
throws `CharivoStateError` before anything is emitted.

```ts
// A reflex: look at the viewer and flinch, whatever is being said.
const reaction = charivo.react({
  source: "alarm",
  hold: { ms: 1500 },
  expression: "Surprised",
  gaze: { x: 0, y: 0 },
  critical: true,
});
reaction.release(); // optional, ends it early
```

### Realtime

Playback is reserved by attachment, not by what is audible: from
`attachRealtime()` to `detachRealtime()`, `getFloor()` is `{ state: "realtime" }`
and `perform()` is refused. `react()` still works, and `critical` finds no
performance to cancel.

`attachRealtime()` throws `CharivoStateError` while a performance holds the
floor, while cancelled speech is unsettled, or from a `dispose()` call until its
teardown is done. It is allowed once the floor is free and every manager with cancelled speech has confirmed its stop: `await
charivo.interrupt()` first, and when that rejects, attaching stays refused until
a later stop on that manager succeeds. Leaving realtime, stop the session before
`detachRealtime()`; detaching never touches the session. The body never calls
the realtime manager's `interrupt()` or `sendMessage()`.

The realtime path deliberately keeps its own contract: `RealtimeManager.sendMessage(...)`
rejects while a response is in progress and requires an explicit `interrupt()`,
because the transport allows one active response at a time. The divergence from
the cascade's latest-wins is intentional, not an inconsistency to normalize.

### Brain port

The brain decides what the character says and drives the body to say it. Core
declares the port and imports no implementation:

```ts
interface ConversationBrain {
  setBody(body: CharacterBody | null): void;
  setCharacter(character: Character): void;
  submit(input: BrainInput): BrainTurn;
  interrupt(): Promise<void>;
  clearHistory(): void;
  getHistory(): Message[];
  dispose?(): void | Promise<void>;
}

interface BrainTurn {
  id: string; // the id of the Message the input resolved to
  done: Promise<BrainTurnResult>; // never rejects
  cancel(): Promise<void>;
}

type BrainTurnResult =
  | { status: "completed" | "cancelled"; text: string; heardText?: string }
  | { status: "silent" }
  | { status: "failed"; stage: "generate" | "render" | "tts"; text: string; error: CharivoError };
```

`CharacterBody` is what a brain is handed, and `Charivo` implements it: the
event bus plus `perform()`, `react()`, `interrupt()` and `getFloor()`.

- `attachBrain(brain)` calls `brain.setBody(this)` and, when a character is set,
  `brain.setCharacter(character)`. Attaching another brain detaches the first.
  `detachBrain()` calls `setBody(null)`, and `setCharacter()` reaches the brain.
  `getBrain()` returns it. `createCharivo({ brain })` attaches one.
- `submit()` throws `CharivoStateError` when no body is attached. Its `done`
  never rejects: a failure is a `failed` result naming the `stage` (`generate`:
  producing the reply; `render`: showing it, with the input kept and the reply
  dropped; `tts`: speaking it, or realtime holding playback).
- `BrainInput` is `{ kind: "user" | "event" | "direction", ... }` with optional
  `respond` (`"must" | "auto" | "silent"`) and `history` (`"keep" |
  "ephemeral" | { replaceKey }`) policies; how a brain applies them is the
  brain's contract. `@charivo/llm`'s `resolveBrainInput()` gives each kind its
  defaults.
- `message:sent { message }` is emitted once for every input, and a turn's id is
  that message's id.

The cascade implementation, its policies and its history rules are in the
[`@charivo/llm` README](../llm/README.md#cascade-brain).

The current render-manager contract is explicit: a `RenderManager` must expose
`setEventBus(eventBus)` and `disconnect()` so the core can connect and cleanly
tear down typed character, TTS, and realtime events without duck typing.

### `RenderManager` public methods

Beyond the event-bus contract, `RenderManager` has three methods the app layer
calls. The core calls none of them, but all three are required members, so a
manager of your own declares them even where it has nothing to do:

- `loadModel(modelPath: string): Promise<void>` — loads or switches the model.
  A manager with nothing to load resolves without doing anything.
- `setLocalGaze(coords: GazeCoordinates): boolean` — drives local-presence gaze
  (e.g. webcam face tracking). Returns `false` (no-op) while AI gaze owns the
  avatar (an `avatar:gaze` claim is still live) or when the renderer has no
  `lookAt`.
- `setMessageCallback(callback)` — sets the one callback the manager invokes
  with each message once the renderer has rendered it, and the character it
  was rendered for, if any. A later call replaces it.

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
  optional `toolCalls`, or `tool` with a required `toolCallId`); it is the
  `messages` type of `LLMClient.call` / `callWithTools` and
  `LLMProvider.generateResponse` / `generateResponseWithTools` alike, so
  protocol-invalid combinations are unrepresentable for typed callers on
  either path
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
- `avatar:release`
- `performance:start`
- `performance:segment`
- `performance:end`
- `floor:changed`
- `realtime:error`

`avatar:gaze` (`GazeCoordinates` plus the claim fields) and `realtime:usage` (a
flat `RealtimeUsageEvent`) intentionally use flat payloads rather than wrapper
objects.

`message:sent { message }` is emitted once for every brain input and carries the
resolved `Message` (`user`, `event` or `direction`), so a chat UI filters on
`message.type`; a turn's id is that message's id. `message:received { message }`
carries the reply about to be performed. `turn:cancelled { turnId }` fires
exactly once for every turn that settles `cancelled` on the cascade path (never
on the realtime path), after the `message:sent` carrying the same id. Speech
progress is reported by the `performance:*` events and `tts:audio:*`.

`avatar:expression` and `avatar:gaze` are claims. Each may carry four optional
fields (`AvatarClaimOptions`), so an event with none is still valid: `source`
(defaults to `"app"`), `priority` (`reflex`, `explicit`, `inferred` or
`ambient`; defaults to `"explicit"`), `hold` (`{ ms }`, `"until-release"` or
`{ performance: id }`; defaults per channel) and `claimId`, which
`RenderManager` stores with the claim it accepts. `avatar:motion` is one-shot and
takes only `priority`. `avatar:release` — `{ source, channel?, claimId? }` — ends
that source's live claim on one channel, or on both when `channel` is omitted;
with `claimId`, it ends the claim only when that claim carries the same id, so a
stale release never clears a newer claim from the same source.

The `performance:*` events are emitted by `perform()` and mark one line of speech
or a silent act so a hold can follow it:

- `performance:start` — `{ performanceId, origin, voiced, text?, affectResolved? }`;
  `text` is set for a string request only
- `performance:segment` — `{ performanceId, origin, index, text }`, one per
  segment of a streamed performance
- `performance:end` — `{ performanceId, origin, status, heardText?, error? }`

`floor:changed { floor }` reports every change of `getFloor()`. An app running
its own speech pipeline may emit the `performance:start` / `performance:end`
pair itself. See
[Claims And Arbitration](../../docs/guide/rendering.md#claims-and-arbitration).

The event bus isolates each listener: one that throws is reported via
`console.error` and does not stop the listeners queued behind it, so `emit`
never throws into its caller. Each `emit` dispatches to a snapshot of the
listener list, so a listener removed mid-emit (its own `off`, or a
`disconnect()` that removes several) still fires for that emit; the removal
applies from the next one.

`EventMap` is an interface, so a package can carry its own events through the
bus by augmenting it — no core change needed:

```ts
import "@charivo/core";

declare module "@charivo/core" {
  interface EventMap {
    "vrm:blendshape": { name: string; weight: number };
  }
}
```

Keep the `import` line: it makes the declaring file a module, so the block
augments the package. In a standalone `.d.ts` without it, the same block
shadows `@charivo/core` and every other export disappears.
