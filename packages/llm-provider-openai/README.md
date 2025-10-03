# @charivo/llm-provider-openai

OpenAI LLM provider for Charivo (server-side).

## Features

- 🔐 **Secure** - Server-side API key management
- 🤖 **OpenAI GPT** - Support for GPT-4, GPT-3.5, and other models
- 💬 **Streaming** - Optional streaming responses
- 🎯 **Type-Safe** - Full TypeScript support

## Installation

```bash
pnpm add @charivo/llm-provider-openai @charivo/core openai
```

## Usage

### Server-side Only

```typescript
import { createOpenAILLMProvider } from "@charivo/llm-provider-openai";

const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4"
});

await provider.initialize();

const response = await provider.chat([
  { id: "1", content: "Hello!", timestamp: new Date(), type: "user" }
]);

console.log(response); // "Hello! How can I help you?"
```

### API Endpoint Usage (Next.js)

```typescript
// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createOpenAILLMProvider } from "@charivo/llm-provider-openai";

const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4"
});

export async function POST(request: NextRequest) {
  try {
    const { messages, character } = await request.json();
    
    const response = await provider.chat(messages, character);
    
    return NextResponse.json({ response });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}
```

### Express.js

```typescript
import express from "express";
import { createOpenAILLMProvider } from "@charivo/llm-provider-openai";

const app = express();
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, character } = req.body;
    const response = await provider.chat(messages, character);
    res.json({ response });
  } catch (error) {
    res.status(500).json({ error: "Chat failed" });
  }
});
```

## API Reference

### Constructor

```typescript
new OpenAILLMProvider(config: OpenAILLMProviderConfig)
```

### Configuration Options

```typescript
interface OpenAILLMProviderConfig {
  /** OpenAI API key (required) */
  apiKey: string;
  /** Model name (default: "gpt-4") */
  model?: string;
  /** Temperature 0-2 (default: 0.7) */
  temperature?: number;
  /** Max tokens (default: 1000) */
  maxTokens?: number;
  /** Top P 0-1 (default: 1.0) */
  topP?: number;
  /** Frequency penalty 0-2 (default: 0) */
  frequencyPenalty?: number;
  /** Presence penalty 0-2 (default: 0) */
  presencePenalty?: number;
}
```

### Methods

#### `initialize()`
Initialize the provider.

```typescript
await provider.initialize();
```

#### `chat(messages, character?)`
Send messages and get a response.

```typescript
const response = await provider.chat(
  [
    { id: "1", content: "Hello!", timestamp: new Date(), type: "user" }
  ],
  {
    id: "assistant",
    name: "Hiyori",
    personality: "Cheerful and helpful"
  }
);
```

#### `destroy()`
Clean up the provider.

```typescript
await provider.destroy();
```

## Supported Models

### GPT-4
- `gpt-4` - Most capable
- `gpt-4-turbo-preview` - Faster, 128K context
- `gpt-4-0125-preview` - Latest GPT-4 Turbo
- `gpt-4-1106-preview` - Previous GPT-4 Turbo

### GPT-3.5
- `gpt-3.5-turbo` - Fast and cost-effective
- `gpt-3.5-turbo-16k` - Extended context

## Configuration Examples

### Balanced (Default)

```typescript
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4",
  temperature: 0.7,
  maxTokens: 1000
});
```

### Creative

```typescript
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4",
  temperature: 0.9,
  frequencyPenalty: 0.5,
  presencePenalty: 0.5
});
```

### Deterministic

```typescript
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4",
  temperature: 0.2,
  topP: 0.9
});
```

### Cost-Effective

```typescript
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-3.5-turbo", // 10x cheaper
  temperature: 0.7,
  maxTokens: 500 // Shorter responses
});
```

## Complete Example

### Server

```typescript
// app/api/chat/route.ts
import { createOpenAILLMProvider } from "@charivo/llm-provider-openai";

const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4"
});

export async function POST(request: NextRequest) {
  const { messages, character } = await request.json();
  const response = await provider.chat(messages, character);
  return NextResponse.json({ response });
}
```

### Client

```typescript
import { createRemoteLLMClient } from "@charivo/llm-client-remote";
import { createLLMManager } from "@charivo/llm-core";

const client = createRemoteLLMClient({
  apiEndpoint: "/api/chat"
});
const llmManager = createLLMManager(client);

await llmManager.initialize();
const response = await llmManager.chat(messages);
```

## Environment Variables

```bash
# .env
OPENAI_API_KEY=sk-...
```

```typescript
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!
});
```

## Error Handling

```typescript
try {
  const response = await provider.chat(messages);
} catch (error) {
  if (error.code === "insufficient_quota") {
    console.error("OpenAI quota exceeded");
  } else if (error.code === "invalid_api_key") {
    console.error("Invalid API key");
  } else if (error.code === "rate_limit_exceeded") {
    console.error("Rate limit exceeded");
  } else {
    console.error("Chat error:", error);
  }
}
```

## Pricing (OpenAI)

### GPT-4
- Input: $30 per 1M tokens
- Output: $60 per 1M tokens

### GPT-4 Turbo
- Input: $10 per 1M tokens
- Output: $30 per 1M tokens

### GPT-3.5 Turbo
- Input: $0.50 per 1M tokens
- Output: $1.50 per 1M tokens

## Related Packages

- [`@charivo/llm-client-remote`](../llm-client-remote) - Client-side remote client
- [`@charivo/llm-client-openai`](../llm-client-openai) - Direct OpenAI client
- [`@charivo/llm-core`](../llm-core) - LLM core functionality

## License

MIT
