# @charivo/llm-client-openai

OpenAI ChatGPT client for Charivo LLM system.

## Features

- 🤖 **OpenAI Integration** - Works with GPT-4, GPT-3.5, and other OpenAI models
- 💬 **Streaming Support** - Optional streaming responses
- 🎯 **Type-Safe** - Full TypeScript support
- 🔧 **Configurable** - Customize model, temperature, and other parameters

## Installation

```bash
pnpm add @charivo/llm-client-openai @charivo/core
```

## Usage

### Basic Setup

```typescript
import { OpenAILLMClient } from "@charivo/llm-client-openai";

const client = new OpenAILLMClient({
  apiKey: "your-openai-api-key",
  model: "gpt-4"
});

await client.initialize();

const response = await client.chat([
  {
    id: "1",
    content: "Hello!",
    timestamp: new Date(),
    type: "user"
  }
]);

console.log(response); // "Hello! How can I help you today?"
```

### With LLMManager (Recommended)

```typescript
import { OpenAILLMClient } from "@charivo/llm-client-openai";
import { createLLMManager } from "@charivo/llm-core";

const client = new OpenAILLMClient({
  apiKey: "your-openai-api-key",
  model: "gpt-4-turbo-preview"
});

const llmManager = createLLMManager(client);

llmManager.setCharacter({
  id: "assistant",
  name: "Hiyori",
  personality: "Cheerful and helpful"
});

await llmManager.initialize();
const response = await llmManager.chat(messages);
```

### Custom Configuration

```typescript
const client = new OpenAILLMClient({
  apiKey: "your-openai-api-key",
  model: "gpt-4",
  temperature: 0.7,      // Creativity (0.0 - 2.0)
  maxTokens: 1000,       // Max response length
  topP: 0.9,             // Nucleus sampling
  frequencyPenalty: 0.5, // Reduce repetition
  presencePenalty: 0.5   // Encourage new topics
});
```

## API Reference

### Constructor

```typescript
new OpenAILLMClient(config: OpenAILLMClientConfig)
```

**Config Options:**
- `apiKey: string` - Your OpenAI API key (required)
- `model?: string` - Model name (default: "gpt-4")
- `temperature?: number` - Sampling temperature 0-2 (default: 0.7)
- `maxTokens?: number` - Max tokens in response (default: 1000)
- `topP?: number` - Nucleus sampling 0-1 (default: 1.0)
- `frequencyPenalty?: number` - Frequency penalty 0-2 (default: 0)
- `presencePenalty?: number` - Presence penalty 0-2 (default: 0)

### Methods

#### `initialize()`
Initialize the client.

```typescript
await client.initialize();
```

#### `chat(messages, character?)`
Send messages and get a response.

```typescript
const response = await client.chat(
  [
    { id: "1", content: "Hi", timestamp: new Date(), type: "user" },
    { id: "2", content: "Hello!", timestamp: new Date(), type: "character" },
    { id: "3", content: "How are you?", timestamp: new Date(), type: "user" }
  ],
  {
    id: "assistant",
    name: "Hiyori",
    personality: "Cheerful"
  }
);
```

#### `destroy()`
Clean up the client.

```typescript
await client.destroy();
```

## Supported Models

### GPT-4 Models
- `gpt-4` - Most capable, best for complex tasks
- `gpt-4-turbo-preview` - Faster, cheaper, 128K context
- `gpt-4-0125-preview` - Latest GPT-4 Turbo
- `gpt-4-1106-preview` - Previous GPT-4 Turbo

### GPT-3.5 Models
- `gpt-3.5-turbo` - Fast and cost-effective
- `gpt-3.5-turbo-16k` - Extended context window

## Configuration Guide

### Temperature

Controls randomness (0.0 - 2.0):
- `0.0-0.3`: Focused, deterministic (good for facts)
- `0.4-0.7`: Balanced (good for conversation)
- `0.8-1.0`: Creative (good for storytelling)
- `1.1-2.0`: Very creative (experimental)

```typescript
// Factual assistant
const factualClient = new OpenAILLMClient({
  apiKey: "...",
  temperature: 0.2
});

// Creative storyteller
const creativeClient = new OpenAILLMClient({
  apiKey: "...",
  temperature: 0.9
});
```

### Max Tokens

Limits response length:
- Short responses: 100-300
- Normal conversation: 500-1000
- Long-form content: 1500-2000

```typescript
const client = new OpenAILLMClient({
  apiKey: "...",
  maxTokens: 500 // Concise responses
});
```

### Penalties

Reduce repetition and encourage diversity:

```typescript
const client = new OpenAILLMClient({
  apiKey: "...",
  frequencyPenalty: 0.5, // Reduce word repetition
  presencePenalty: 0.5   // Encourage new topics
});
```

## Error Handling

```typescript
try {
  const response = await client.chat(messages);
} catch (error) {
  if (error.code === "insufficient_quota") {
    console.error("OpenAI quota exceeded");
  } else if (error.code === "invalid_api_key") {
    console.error("Invalid API key");
  } else {
    console.error("OpenAI error:", error);
  }
}
```

## Environment Variables

Use environment variables for API keys:

```bash
# .env
OPENAI_API_KEY=sk-...
```

```typescript
const client = new OpenAILLMClient({
  apiKey: process.env.OPENAI_API_KEY!
});
```

## Cost Optimization

1. **Use GPT-3.5 for simple tasks**: 10x cheaper than GPT-4
2. **Limit maxTokens**: Reduce response length
3. **Cache responses**: Store common responses
4. **Use temperature wisely**: Lower temperature = more deterministic = better caching

```typescript
// Cost-effective setup
const client = new OpenAILLMClient({
  apiKey: "...",
  model: "gpt-3.5-turbo", // Cheaper
  maxTokens: 300,         // Shorter responses
  temperature: 0.3        // More cacheable
});
```

## License

MIT
