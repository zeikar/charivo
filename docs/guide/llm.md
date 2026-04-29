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
import { Charivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";

const charivo = new Charivo();

charivo.attachLLM(
  createLLMManager(createRemoteLLMClient({ apiEndpoint: "/api/chat" })),
);
charivo.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
});
```

Set the character through `charivo.setCharacter(...)` after attaching managers.
That keeps character state aligned across LLM, rendering, and realtime
managers.

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

Realtime sessions maintain conversation state on the provider side and are not
affected by `maxHistoryTurns`.

## Alternatives

- Use OpenClaw when your backend or testing flow targets OpenClaw instead of OpenAI.
- Use the stub client when you want UI behavior without network or model variability.
- Use direct browser clients only when development speed matters more than credential isolation.

## References

- [LLM Package README](https://github.com/zeikar/charivo/blob/main/packages/llm/README.md)
- [Examples Web](./examples-web.md)
