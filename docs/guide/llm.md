---
title: LLM
sidebar_position: 6
---

# LLM

Charivo's LLM layer is built from two pieces:

- `@charivo/llm-core` for conversation state
- an `LLMClient` implementation for transport

For production browser apps, pair `llm-core` with `@charivo/llm-client-remote`
and a server route backed by a provider package.

## Recommended Stack

```text
@charivo/llm-core
@charivo/llm-client-remote
your /api/chat route
@charivo/llm-provider-openai
```

This keeps the browser client simple and vendor credentials on the server.

## Basic Setup

```ts
import { Charivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";

const charivo = new Charivo();
const llmManager = createLLMManager(
  createRemoteLLMClient({ apiEndpoint: "/api/chat" }),
);

charivo.attachLLM(llmManager);
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

- `@charivo/llm-client-remote`
- best default for production browser apps
- expects your route to receive `messages` and return `{ success, message }`

### Direct OpenAI

- `@charivo/llm-client-openai`
- useful for local development and testing
- exposes credentials to the browser

### Direct OpenClaw

- `@charivo/llm-client-openclaw`
- useful when your app targets an OpenClaw deployment directly
- best treated as a development or trusted-environment option unless browser access is intentional

### Stub

- `@charivo/llm-client-stub`
- useful for UI work, deterministic demos, and tests

## Provider Choices

Remote clients pair with provider packages on the server:

- `@charivo/llm-provider-openai`
- `@charivo/llm-provider-openclaw`

Minimal OpenAI route shape:

```ts
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});

const text = await provider.generateResponse(messages);
```

## What `llm-core` Owns

- message history
- character-aware prompt building
- response generation through an injected client

The client is replaceable. The manager remains the stable place for
conversation state.

## Alternatives

- Use OpenClaw when your backend or testing flow targets OpenClaw instead of OpenAI.
- Use the stub client when you want UI behavior without network or model variability.
- Use direct browser clients only when development speed matters more than credential isolation.

## References

- [llm-core README](https://github.com/zeikar/charivo/blob/main/packages/llm-core/README.md)
- [llm-client-remote README](https://github.com/zeikar/charivo/blob/main/packages/llm-client-remote/README.md)
- [llm-provider-openai README](https://github.com/zeikar/charivo/blob/main/packages/llm-provider-openai/README.md)
- [Examples Web](./examples-web.md)
