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
  automatically). A projector throwing turns into an `error` event
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
- `generateResponse(message)`
- `getHistory()`
- `clearHistory()`
- `setEventEmitter(eventEmitter)` — wired automatically by `Charivo.attachLLM(...)`
- `registerTool(tool)` / `unregisterTool(name)` / `getRegisteredTools()`
- `setToolInstructions(instructions | null)`
