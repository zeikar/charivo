# @charivo/llm-client-stub

Mock LLM client for [Charivo](https://github.com/zeikar/charivo) that returns predefined responses in rotation — no API calls, no API keys required.

## Features

- Zero configuration — no API keys or environment variables needed
- Returns a rotating set of predefined responses with emotion tags (e.g. `[happy]`, `[thinking]`)
- Simulates network latency with a 500ms delay
- Stateless design — session management is handled externally
- Ideal for UI development, integration testing, and demos

## Installation

```bash
npm install @charivo/llm-client-stub
```

## Usage

### Basic

```typescript
import { createStubLLMClient } from "@charivo/llm-client-stub";

const client = createStubLLMClient();

const response = await client.call([
  { role: "user", content: "Hello!" },
]);
console.log(response);
// e.g. "Hello! [happy] I'm a test character."
```

### With Charivo LLMManager

```typescript
import { LLMManager } from "@charivo/llm-core";
import { createStubLLMClient } from "@charivo/llm-client-stub";

const client = createStubLLMClient();
const manager = new LLMManager({ client });

const response = await manager.chat("Tell me something");
console.log(response);
```

### Conditional Usage (Development vs. Production)

```typescript
import { createStubLLMClient } from "@charivo/llm-client-stub";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";

const client =
  process.env.NODE_ENV === "development"
    ? createStubLLMClient()
    : createRemoteLLMClient({ apiEndpoint: "/api/chat" });
```

## Predefined Responses

The stub cycles through 12 built-in responses that include various emotion tags:

| Response | Emotion |
|----------|---------|
| `"Hello! [happy] I'm a test character."` | happy |
| `"The weather is really nice today! [excited]"` | excited |
| `"How can I help you? [neutral]"` | neutral |
| `"[thinking] That's an interesting question. Could you tell me more?"` | thinking |
| `"Yes, understood! [happy]"` | happy |
| `"I see. [neutral] That's an interesting story."` | neutral |
| `"I think so too. [happy]"` | happy |
| `"Hmm... [thinking] that's a difficult question."` | thinking |
| `"Oh no... [sad] I'm sorry to hear that."` | sad |
| `"What?! [surprised] Really?"` | surprised |
| `"That makes me upset. [angry]"` | angry |
| `"I'm a bit embarrassed... [shy]"` | shy |

## API Reference

### `createStubLLMClient()`

Factory function that creates a `StubLLMClient` instance.

### `StubLLMClient`

Implements the `LLMClient` interface from `@charivo/core`.

#### Methods

- `call(messages: Array<{ role: string; content: string }>): Promise<string>`
  — Ignores input messages and returns the next predefined response after a 500ms delay.

## Related Packages

- [`@charivo/llm-client-remote`](../llm-client-remote) — HTTP proxy client (for production)
- [`@charivo/llm-client-openai`](../llm-client-openai) — OpenAI client
- [`@charivo/core`](../core) — Core interfaces

## License

MIT
