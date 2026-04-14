# LLM

This guide answers one question: how should you choose and wire the LLM layer
in Charivo?

Use it when you want text chat or character-driven responses and need to choose
between remote, direct, OpenClaw, or stub paths.

## Recommended Default

For production browser apps, use:

```text
@charivo/llm-core
@charivo/llm-client-remote
your /api/chat route
@charivo/llm-provider-openai
```

That keeps the browser client simple and the provider credentials on the
server.

## Core Wiring

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
That keeps the character state consistent across LLM, rendering, and realtime
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
- treat it like a development or trusted-environment option unless your deployment model explicitly allows browser access

### Stub

- `@charivo/llm-client-stub`
- useful for UI work, deterministic demos, and tests

## Provider Choices

Remote LLM clients pair with provider packages on the server:

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

That means the client is replaceable, but the manager remains the stable place
for conversation state.

## When To Use Another Path

- Use OpenClaw when your backend or testing flow targets OpenClaw instead of OpenAI.
- Use the stub client when you want UI behavior without network or model variability.
- Use direct browser clients only when development speed matters more than credential isolation.

## References

- [llm-core README](../../packages/llm-core/README.md)
- [llm-client-remote README](../../packages/llm-client-remote/README.md)
- [llm-provider-openai README](../../packages/llm-provider-openai/README.md)
- [Examples Web](./examples-web.md)

## Next Steps

- [Choosing Packages](./choosing-packages.md)
- [TTS](./tts.md)
- [Examples Web](./examples-web.md)
