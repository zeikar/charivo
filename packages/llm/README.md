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

## Exports

- `LLMManager`
- `createLLMManager(client)`
- `CharacterPromptBuilder`
- `MessageHistoryManager`
- `MessageConverter`
- `ResponseMessageBuilder`
- `LLMValidators`

## Manager API

- `setCharacter(character)`
- `getCharacter()`
- `generateResponse(message)`
- `getHistory()`
- `clearHistory()`
