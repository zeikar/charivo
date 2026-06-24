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

## Exports

- `createLLMManager(client, options?)`
- `LLMManagerOptions`

## Manager API

- `setCharacter(character)`
- `getCharacter()`
- `generateResponse(message)`
- `getHistory()`
- `clearHistory()`
