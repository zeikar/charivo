# @charivo/llm

Stateful LLM manager for Charivo conversations.

`@charivo/llm` owns character-aware prompt building and message history.
It wraps an `LLMClient` implementation from another package.

## Install

```bash
pnpm add @charivo/llm
```

Requires Node.js 22 or newer, as declared in this package's `engines`.

## Usage

```ts
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";

const manager = createLLMManager(
  createRemoteLLMClient({ apiEndpoint: "/api/chat" }),
);

manager.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
});

const reply = await manager.generateResponse({
  id: "1",
  content: "Hello",
  timestamp: new Date(),
  type: "user",
});
```

## History Retention

`LLMManager` keeps the latest 40 turns by default. A turn is one user message
plus one character response, so the stored conversation history is capped at 80
messages. This bounds memory growth and the context sent to your LLM client.

Pass `maxHistoryTurns` to change the limit:

```ts
const manager = createLLMManager(client, {
  maxHistoryTurns: 20,
});
```

Use `maxHistoryTurns: null` to opt out and keep unbounded history.

## Typed Input

History entries are `user`, `character`, `system`, `direction` (a private stage
cue from the app) or `event` (data from outside the app, with a required
`source`). The converter sends each one with its own role, keeps events out of
system authority, and escapes user turns that try to pose as either. Use
`directionRole: "user"` with Gemini, which folds `system` messages into its
system instruction:

```ts
import { createLLMManager, resolveBrainInput } from "@charivo/llm";

const manager = createLLMManager(client, { directionRole: "user" });

const cue = resolveBrainInput({ kind: "direction", text: "Wrap up the topic." });
// cue.respond === "must", cue.history === "ephemeral"
await manager.generateResponse(cue.message, { ephemeral: true });

const score = resolveBrainInput({ kind: "event", source: "game", text: "2-0" });
manager.addToHistory(score.message, { replaceKey: "score" });
```

The projection table, defaults, measured provider behavior and the OpenClaw
pinned-session boundary are in the
[LLM guide](https://github.com/zeikar/charivo/blob/main/docs/guide/llm.md#typed-input).

## Tool Calling

`LLMManager` can run a tool-calling loop instead of a plain `call(...)` when
both sides opt in: at least one tool is registered *and* the injected
`LLMClient` implements the optional `callWithTools(messages, tools)` method.
Otherwise `generateResponse(...)` falls back to the plain `call(...)` path.

```ts
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";
import {
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";

const catalog = { expressions: ["Smile"], motions: { Idle: 2 } };

const manager = createLLMManager(
  createRemoteLLMClient({ apiEndpoint: "/api/chat" }),
  {
    tools: createAvatarControlTools(catalog),
    resultProjectors: [createAvatarResultProjector()],
    toolInstructions: buildAvatarControlInstructions(catalog),
  },
);
```

`LLMManagerOptions` tool fields:

- `tools?: ToolRegistration[]` — registered at construction; also available
  after construction via `registerTool(tool)` / `unregisterTool(name)`
- `resultProjectors?: ToolResultProjector[]` — run after a successful tool
  call, when an event emitter is attached (`createCascadeBrain(...)` wires one
  automatically). A projector throwing turns into an `llm:error` event
  (`Error` message: `` LLM result projector failed for tool "<name>": <cause> ``)
  instead of failing the reply.
- `toolInstructions?: string` — appended to the character system prompt, but
  only on the tools path (registered tools + a tool-capable client); it has no
  effect on the plain `call(...)` path.

Tools are `ToolRegistration` values from `@charivo/core` — the same contract
`@charivo/realtime` uses, so tool builders such as `@charivo/avatar`'s
`createAvatarControlTools(...)` work with both managers. Tool arguments are
validated against each definition's schema, and results are timed out
(`defaultToolTimeoutMs`, 10s default, overridable per tool via
`timeoutMs`) and asserted to be plain objects before a projector runs. Any
failure in *executing* a tool — unknown tool, invalid arguments, handler
throw/timeout, non-object result — becomes a `{ success: false, error }` tool
output so the reply continues instead of throwing.

A malformed tool call from the provider is a different matter: it never reaches
a handler. The shipped OpenAI-format providers raise `CharivoProviderError`
before the manager sees a tool when a call has no usable `id`, declares a
`type` other than `"function"` (a call omitting `type` is still accepted),
carries no `function.name`, or has `function.arguments` that are not a string
parsing to a JSON object.

### Tool Events

When an event emitter is attached, the manager emits `tool:call` before each
tool executes, then either `tool:result` on success or `tool:error` on any
failure. `@charivo/realtime` emits the same three events, so a listener can
observe tool activity without caring which modality ran the tool.

`tool:result` carries the JSON-serialized snapshot of the handler result — the
same value the model's tool turn receives — so a result with a `toJSON()`
surfaces as its round-tripped form.

`resultProjectors` receive that same snapshot, as they do in
`@charivo/realtime`, so a projector behaves identically no matter which
modality ran the tool. It is the wire form, not the live handler object: a
`Date` arrives as its ISO string and an `undefined` property is gone, so read
`output` as plain JSON. Values that cannot survive JSON were never part of the
tool result anyway — the model only ever sees the serialized form.

### Round Cap

The tool loop executes at most 3 tool-calling rounds. After the third round,
the manager makes one more `callWithTools(...)` call with an **empty tools
array** so the model is forced to answer in text instead of requesting another
tool call; that terminal response's `content` becomes the reply.

### Remote Protocol

`@charivo/llm/remote`'s `callWithTools(messages, tools)` posts
`{ messages, tools }` (tools included as-is, even when empty) to your chat
route and expects `{ success: true, message: string, toolCalls?: LLMToolCall[] }`
back. `toolCalls` is omitted (or empty) when the model didn't call a tool.
On the wire, `tools: []` is a valid, distinct request from omitting `tools`
entirely — server routes typically treat any request carrying `tools` (even
empty) or a tool-call/tool-result turn in `messages` as needing the
tool-calling provider path, and only map an empty tools array to "no tools"
when calling the underlying model.

### History Exclusion

Only the final assistant text is added to `LLMManager`'s history. Intermediate
assistant `toolCalls` turns and `role: "tool"` result turns exist only inside
one `generateResponse(...)` call's tool loop — `getHistory()` and the stored
conversation always stay a plain transcript, free of tool turns, that other
modalities can reuse.

## Cascade Brain

`createCascadeBrain(llm, { review? })` turns any `LLMManager` into the
`ConversationBrain` that `@charivo/core` hosts: each input that responds is
generated by the manager, then performed through the body, so the same
`perform()` that speaks a scripted line speaks the reply.

```ts
import { createCharivo } from "@charivo/core";
import { createCascadeBrain, createLLMManager } from "@charivo/llm";

const charivo = createCharivo({
  brain: createCascadeBrain(createLLMManager(client)),
  tts: ttsManager,
  renderer: renderManager,
  character,
});

const turn = charivo.getBrain()!.submit({ kind: "user", text: "Hello" });
const result = await turn.done;
```

The one-call text turn on `Charivo` and its LLM attach, detach and getter
methods are removed; `submit({ kind: "user", text }).done` replaces them. The brain gives the manager
one forwarding emitter (`llm.setEventEmitter`) that passes each event to the
body attached at that moment and drops it when none is, so tool events reach the
current bus and never a detached one. `setCharacter`, `clearHistory` and
`getHistory` go to the manager; `dispose()` cancels the live turn and clears the
history; detaching the brain (`setBody(null)`) cancels the live turn.

### `submit()` and its results

`submit(input)` resolves the input with `resolveBrainInput()`, emits
`message:sent { message }` once for every input, and returns a turn whose `id`
is that message's id. It throws `CharivoStateError` with no body attached. `done`
never rejects and settles with a `BrainTurnResult`:

- `{ status: "completed", text, heardText }` — the reply was performed in full.
- `{ status: "cancelled", text, heardText? }` — the turn was retired, or its
  performance was cancelled. A cascade reply is one string, so `heardText` is
  the full text, `""` or unknown; a reply whose performance was cancelled with
  `heardText: ""` is taken back out of history, since nobody heard it. When it is
  omitted the reply stays.
- `{ status: "silent" }` — the input did not respond, or `review` returned `null`.
- `{ status: "failed", stage, text, error }` — `stage` is `generate` (the
  request, the history write or `review`; when the request or `review` fails, a
  live turn's own input write is rolled back, but when committing the reply
  itself fails the input stays), `render` (the input is kept, the reply dropped) or `tts` (the
  reply stays in history; this is also what a `perform()` refused because
  realtime holds playback gives, with the reply uncommitted). `error` is the
  typed provider error.

`turn.cancel()` and `brain.interrupt()` retire the live turn without a
successor; they resolve when the cancel of its performance has and reject with
that stop's error. On a turn that is no longer live they do nothing. Every turn
that settles `cancelled` emits `turn:cancelled { turnId }`, after the
`message:sent` carrying the same id.

### Policies

`resolveBrainInput()` gives each kind its defaults (`user` must/keep, `event`
auto/keep, `direction` must/ephemeral); the brain applies them like this.

- `respond: "must"` supersedes the live turn. `"silent"` makes no request.
  `"auto"` responds only when the brain has no live turn under way and
  `body.getFloor()` is `idle`; otherwise it behaves as `silent`. An input that
  does not respond leaves the live turn alone and settles `{ status: "silent" }`.
- `history: "keep"` stores the input with `addToHistory`; `{ replaceKey }` stores
  it under that key; `"ephemeral"` is never written and rides along with
  `ephemeral: true`. The policy applies whatever `respond` is. An input the
  manager refuses to store ends the turn `failed` at `generate` with that state
  error and makes no request.
- **Latest wins.** A responding `submit()` retires the live turn: its request is
  aborted through its `AbortSignal`, its performance is cancelled and it settles
  `cancelled`. History order is call order at any reentrancy depth, and an
  unheard reply is rolled back synchronously at retirement, so it neither
  reaches the next request nor costs an older entry its place in a bounded
  history. A rejected stop of the retired performance keeps that speech
  unsettled, and the newer turn ends `failed` at `tts` with it.

### Presentation

The reply is presented as `message:received { message }`, then
`body.perform({ text, origin: "cascade", affect })`. It is committed with
`addToHistory` when `perform()`'s `started` resolves `true`, so before it is
spoken and never on `performance:start`. A reply generated for an ephemeral
input, which has no stored prompt, is committed as `standalone: true`, so
pruning does not take it for a reply that lost its prompt.

### `review`

`review({ reply: { text, affect? }, directions })` is awaited after generation
and before presentation. The reply it returns is the one presented, so it can
rewrite the text or attach an `affect` cue; returning `null` ends the turn
`silent` with nothing presented, no `message:received`, and the input's history
write kept. A throw ends the turn `failed` at `generate`. `directions` is a
snapshot taken when the request is built: the `direction` entries then in
history, plus the turn's own input when it is an ephemeral direction.

```ts
const brain = createCascadeBrain(manager, {
  review: ({ reply, directions }) =>
    reply.text.trim() === "" ? null : { ...reply, affect: { expression: "Smile" } },
});
```

### Tool-chosen expressions

During generation the brain takes the `avatar:expression` a tool projects (the
last one wins) through `interceptProjection` and does not emit it; every other
projected event (the `lookAt` gaze, the muted `playMotion`) goes through
unchanged. The held expression arrives with the line: it is the performance's
`affect`, unless `review` supplies one. A tool-chosen expression is therefore not
shown during generation, only with the speech.

## Exports

- `createLLMManager(client, options?)`
- `createCascadeBrain(llm, options?)`, `CascadeBrainOptions`, `CascadeReply`,
  `CascadeReviewInput`
- `LLMManagerOptions` (including `directionRole`)
- `resolveBrainInput(input, options?)`, `ResolvedBrainInput`,
  `ResolveBrainInputOptions`, `DirectionRole`
- `@charivo/llm/openai`: `createOpenAILLMClient(config)` (browser client,
  dev/testing only) and, for server-side use, `createOpenAILLMProvider(config)`,
  `OpenAILLMProvider`, `type OpenAILLMConfig`, `type OpenAIReasoningEffort`.
  The default model is `gpt-5.6-luna`, sent with `reasoning_effort: "none"`;
  set `reasoningEffort` for other gpt-5 family models
- `@charivo/llm/openclaw`: `createOpenClawLLMClient(config)` (browser client,
  dev/testing only) and, for server-side use, `createOpenClawLLMProvider(config)`,
  `OpenClawLLMProvider`, `type OpenClawLLMConfig`. `sessionKey` exists only on
  the provider config — `LLMManager.clearHistory()` can only clear local
  history, not rotate a pinned gateway session, so a client-side `sessionKey`
  would silently replay the old transcript after a reset. Server routes that
  construct the provider directly can rotate `sessionKey` themselves.
- `@charivo/llm/gemini`: `createGeminiLLMClient(config)` (browser client,
  dev/testing only) and, for server-side use, `createGeminiLLMProvider(config)`,
  `GeminiLLMProvider`, `type GeminiLLMConfig`. Tool-call history is resent with
  Gemini's documented `skip_thought_signature_validator` placeholder because
  `LLMToolCall` carries no thought signature, so reasoning continuity across
  tool rounds is lost.

## Manager API

- `setCharacter(character)`
- `getCharacter()`
- `addToHistory(message, options?)` — `options.replaceKey`
- `generateResponse(message, options?)`
- `getHistory()`
- `clearHistory()`
- `setEventEmitter(eventEmitter)` — wired by `createCascadeBrain(...)`, which forwards to the attached body
- `registerTool(tool)` / `unregisterTool(name)` / `getRegisteredTools()`
- `setToolInstructions(instructions | null)`

### Caller-Owned History

`addToHistory(message, options?)` ensures `message` is present in the manager's history
and returns a `HistoryRollback` (from `@charivo/core`) — a zero-argument,
idempotent undo handle. It is synchronous, and it appends only when that exact
object is not already present (reference identity, not id), then prunes to the
configured bound. That prune repairs orphans: when it actually evicts
something it also drops leading character messages, so an eviction never
leaves history starting with a reply whose user message is gone, while a
deliberately character-first history — a seeded greeting, or a reply committed
after `clearHistory()` — is preserved.

The returned handle removes its message if it is still present and restores
what *that* call evicted, but only while nothing else has written to history
since; a call that appended nothing returns an inert handle, so it can neither
delete the message nor invalidate an earlier handle. A message the manager
cannot store is rejected with a typed `CharivoStateError`: every type except
`character` needs non-empty string content and an `event` also needs a
non-empty `source`, while a `type: "character"` message is stored as produced,
empty content included.

With `{ replaceKey }`, the message last stored under that key is removed (if it
is still in history) and the new one is appended; the handle puts the replaced
entry back at its old position under the same no-intervening-write rule.

With `{ standalone: true }`, the message is a reply that has no stored input
(its input was ephemeral or never stored). When a prune evicts something it
drops leading character messages whose user message is gone, but never a
standalone one.

`generateResponse(message, options?)` accepts `GenerateResponseOptions`:

- `callerOwnsHistory` — the caller has already placed the message via
  `addToHistory` and commits the reply itself, so the call performs **no**
  history writes: no append, no reply commit, no rollback on failure.
  Character and message validation and prompt building are unchanged, and the
  prompt still comes from history, which already holds the message.
- `isCancelled` — reports that the call has been superseded. It is consulted
  before each further tool call, between a call's `tool:call` emission and its
  handler, before each follow-up request, and on every projected emission,
  including repeated emissions from inside one projector. Once it returns
  `true` the call starts nothing further and projects nothing further, then
  resolves with the latest response text. It aborts neither an in-flight
  request nor an already-running handler, and it does not govern history
  writes.
- `ephemeral` — show the message to the model for this request only: the
  prompt is the history plus the message, and the message is never written,
  on success or failure. The reply is still committed, as a standalone reply,
  unless `callerOwnsHistory` is set, in which case the caller commits it
  (`addToHistory(reply, { standalone: true })`).
- `interceptProjection(event, payload)` — takes a projected event (a tool
  result shown on the avatar) for this request instead of emitting it:
  returning `true` consumes it, `false` lets it through to the event emitter.
  It is called for every projected event, in order, so the caller can hold back
  what it will present itself; the cascade brain takes `avatar:expression`.
- `signal` — an `AbortSignal` forwarded to the client as `LLMCallOptions.signal`
  on every `call`/`callWithTools` request the call makes, tool rounds
  included. Distinct from `isCancelled`: this is what aborts the in-flight
  request itself, rather than gating new work between steps.

The cascade brain always passes `callerOwnsHistory`, `isCancelled`, `signal` and
`interceptProjection` — see [Cascade Brain](#cascade-brain) for the latest-wins
turn contract.

Direct, manager-only use is otherwise unchanged: omit the options and
`generateResponse(...)` stays self-contained, appending the user message,
committing the reply, pruning the completed pair as before, and rolling back
on failure — that rollback now works by reference identity, so overlapping
direct calls no longer roll back each other's messages.

**Migrating a custom `LLMManager`:** `addToHistory(message, options?)` is a
required member; `options.replaceKey` and `GenerateResponseOptions.ephemeral`
are optional to honor, but a brain that relies on them needs them. Implement it synchronously; reject what you cannot store with a typed
state error; append only when the exact object is absent; return an inert
handle when you appended nothing, and otherwise an idempotent handle that
removes its own message and restores its own evictions only when nothing else
has written since; hold your own bound; and neither emit events nor call back
into its caller (the cascade brain). Build the prompt before your first
`await`: the brain relies on it to keep silent inputs out of the turn's
prompt. Honor `callerOwnsHistory` by suppressing every history write
for that call, and `isCancelled` by starting no new tool work and dropping
every further projected emission once it returns `true`. Honor
`interceptProjection` by offering it each projected event before emitting it. Forward `signal` to
your client's calls if you want real request cancellation — the built-in
manager passes it through as `LLMCallOptions.signal`, but the option is
otherwise a no-op unless a manager forwards it.
