# @charivo/llm

Stateful LLM manager for Charivo conversations.

`@charivo/llm` owns character-aware prompt building and message history.
It wraps an `LLMClient` implementation from another package.

## Install

```bash
pnpm add @charivo/llm
```

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
  call, when an event emitter is attached (`Charivo.attachLLM(...)` wires one
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
failure — unknown tool, invalid arguments, handler throw/timeout, non-object
result — becomes a `{ success: false, error }` tool output so the reply
always continues instead of throwing.

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
conversation always stay a plain user/character transcript that other
modalities can reuse.

## Exports

- `createLLMManager(client, options?)`
- `LLMManagerOptions`
- `@charivo/llm/openai`: `createOpenAILLMClient(config)` (browser client,
  dev/testing only) and, for server-side use, `createOpenAILLMProvider(config)`,
  `OpenAILLMProvider`, `type OpenAILLMConfig`
- `@charivo/llm/openclaw`: `createOpenClawLLMClient(config)` (browser client,
  dev/testing only) and, for server-side use, `createOpenClawLLMProvider(config)`,
  `OpenClawLLMProvider`, `type OpenClawLLMConfig`. `sessionKey` exists only on
  the provider config — `LLMManager.clearHistory()` can only clear local
  history, not rotate a pinned gateway session, so a client-side `sessionKey`
  would silently replay the old transcript after a reset. Server routes that
  construct the provider directly can rotate `sessionKey` themselves.

## Manager API

- `setCharacter(character)`
- `getCharacter()`
- `addToHistory(message)`
- `generateResponse(message, options?)`
- `getHistory()`
- `clearHistory()`
- `setEventEmitter(eventEmitter)` — wired automatically by `Charivo.attachLLM(...)`
- `registerTool(tool)` / `unregisterTool(name)` / `getRegisteredTools()`
- `setToolInstructions(instructions | null)`

### Caller-Owned History

`addToHistory(message)` ensures `message` is present in the manager's history
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
cannot store is rejected with a typed `CharivoStateError`: a `type: "user"`
message needs non-empty string content, while a `type: "character"` message is
stored as produced, empty content included — each rule matching the existing
write path it takes over.

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

`Charivo.userSay(text)` always passes both — see the latest-wins turn contract
in the [core README](../core/README.md#charivo).

Direct, manager-only use is otherwise unchanged: omit the options and
`generateResponse(...)` stays self-contained, appending the user message,
committing the reply, pruning the completed pair as before, and rolling back
on failure — that rollback now works by reference identity, so overlapping
direct calls no longer roll back each other's messages.

**Migrating a custom `LLMManager`:** `addToHistory(message)` is now a required
member. Implement it synchronously; reject what you cannot store with a typed
state error; append only when the exact object is absent; return an inert
handle when you appended nothing, and otherwise an idempotent handle that
removes its own message and restores its own evictions only when nothing else
has written since; hold your own bound; and neither emit events nor call back
into `Charivo`. Honor `callerOwnsHistory` by suppressing every history write
for that call, and `isCancelled` by starting no new tool work and dropping
every further projected emission once it returns `true`.
