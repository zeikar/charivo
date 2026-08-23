---
title: LLM
sidebar_position: 6
---

# LLM

Charivo's LLM layer is built from two pieces:

- `@charivo/llm` for conversation state
- an `LLMClient` implementation for transport

For production browser apps, pair `@charivo/llm` with `@charivo/llm/remote`
and a server route backed by a provider package.

## Recommended Stack

```text
@charivo/llm
@charivo/llm/remote
your /api/chat route
@charivo/server/openai
```

This keeps the browser client simple and vendor credentials on the server.

## Basic Setup

```ts
import { createCharivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";

const charivo = createCharivo({
  llm: createLLMManager(createRemoteLLMClient({ apiEndpoint: "/api/chat" })),
  character: {
    id: "hiyori",
    name: "Hiyori",
    personality: "Cheerful and helpful assistant",
  },
});
```

`createCharivo` applies the character after attaching, so it reaches the LLM,
rendering, and realtime managers together. When you attach by hand instead,
call `charivo.setCharacter(...)` after the `attach*` calls to keep that
character state aligned.

## Client Choices

### Remote

- `@charivo/llm/remote`
- best default for production browser apps
- expects your route to receive `messages` and return `{ success, message }`

### Direct OpenAI

- `@charivo/llm/openai`
- useful for local development and testing
- exposes credentials to the browser

### Direct OpenClaw

- `@charivo/llm/openclaw`
- useful when your app targets an OpenClaw deployment directly
- best treated as a development or trusted-environment option unless browser access is intentional

### Stub

- `@charivo/llm/stub`
- useful for UI work, deterministic demos, and tests

## Provider Choices

Remote clients pair with provider packages on the server:

- `@charivo/server/openai`
- `@charivo/server/openclaw`

Minimal OpenAI route shape:

```ts
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});

const text = await provider.generateResponse(messages);
```

## Avatar Tool Calling

`LLMManager` can drive `@charivo/avatar`'s tools the same way
`RealtimeManager` does, on top of the recommended remote stack. The tool loop
turns on only when both a tool is registered and the client implements
`callWithTools` — `@charivo/llm/remote` does, provided your route forwards
`tools` to a provider's `generateResponseWithTools`.

```ts
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";
import {
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";

const catalog = {
  expressions: ["Smile", "Sad"],
  motions: { Idle: 2, TapBody: 2 },
  expressionDescriptions: { Smile: "happy or amused", Sad: "downcast or disappointed" },
  motionDescriptions: { Idle: ["resting", "shifting weight"], TapBody: ["waves hello", "folds her arms"] },
};

const manager = createLLMManager(
  createRemoteLLMClient({ apiEndpoint: "/api/chat" }),
  {
    tools: createAvatarControlTools(catalog),
    resultProjectors: [createAvatarResultProjector()],
    toolInstructions: buildAvatarControlInstructions(catalog),
  },
);

charivo.attachLLM(manager);
```

`attachLLM(...)` wires the event emitter that `resultProjectors` need to turn
successful tool calls into `avatar:expression` / `avatar:motion` /
`avatar:gaze` events; a `RenderManager` attached to the same `Charivo`
instance already listens for them. The same emitter also makes the tool loop
publish `tool:call` / `tool:result` / `tool:error` around every tool execution,
the same events `RealtimeManager` emits, so you can log or inspect tool activity
from one place.

On the server side, your route needs to accept an optional `tools` array and
call the tool-calling variant of your provider whenever the request needs it —
that includes both a `tools`-carrying request (even `tools: []`, the terminal
round) and a plain request whose `messages` already contain a tool-call or
tool-result turn:

```ts
const { messages, tools } = parsedBody;
const needsTools = tools !== undefined || messages.some(isToolishMessage);

const result = needsTools
  ? await provider.generateResponseWithTools(messages, tools ?? [])
  : { content: await provider.generateResponse(messages) };

return NextResponse.json({
  success: true,
  message: result.content,
  toolCalls: "toolCalls" in result ? result.toolCalls : undefined,
});
```

See [`examples/web/src/app/api/chat-request.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/api/chat-request.ts)
for the full request-parsing and validation this demo uses (`parseChatRequest`,
`requiresToolCallingPath`, `isToolishMessage`).

The tool loop runs at most 3 rounds before a final `tools: []` call forces a
text-only reply, and only the final assistant text is added to
`LLMManager`'s history — see [Tool Calling](https://github.com/zeikar/charivo/blob/main/packages/llm/README.md#tool-calling)
in the package README for the full round-cap and remote protocol details.

## What `@charivo/llm` Owns

- message history
- character-aware prompt building
- response generation through an injected client

The client is replaceable. The manager remains the stable place for
conversation state.

## History Retention

`LLMManager` keeps the latest 40 turns by default. A turn is one user message
plus one character response, so `getHistory()` and LLM client calls are bounded
to the latest 80 stored messages. This keeps long-running chat sessions from
growing memory and context cost without additional app code.

Override the limit with `createLLMManager(client, { maxHistoryTurns })`, or use
`maxHistoryTurns: null` if your app needs the previous unbounded behavior.

Under `Charivo` orchestration the turn's history writes belong to `Charivo`,
not to the manager: `userSay(text)` places the user message through
`addToHistory(...)`, calls `generateResponse(..., { callerOwnsHistory: true })`
so the manager writes nothing for that call, and commits the reply itself once
the turn has reached presentation. That is what keeps a superseded turn's user
message in history while its unspoken reply never enters it — see the
latest-wins turn contract in the
[core README](https://github.com/zeikar/charivo/blob/main/packages/core/README.md#charivo).
`maxHistoryTurns` then applies to those messages like any other.

`Charivo` also passes a per-turn `signal` alongside `isCancelled`, so a
superseded turn's in-flight request is aborted rather than left running when
the client honors the optional signal — `@charivo/llm/remote` does; a client
that ignores it (such as the direct OpenAI dev client) keeps the old
run-to-completion behavior. A custom `LLMManager` should forward `signal` to
its client for real request cancellation; the built-in manager already does.

Realtime sessions maintain conversation state on the provider side and are not
affected by `maxHistoryTurns`.

## Alternatives

- Use OpenClaw when your backend or testing flow targets OpenClaw instead of OpenAI.
- Use the stub client when you want UI behavior without network or model variability.
- Use direct browser clients only when development speed matters more than credential isolation.

## References

- [LLM Package README](https://github.com/zeikar/charivo/blob/main/packages/llm/README.md)
- [Examples Web](./examples-web.md)
