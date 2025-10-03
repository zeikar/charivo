# @charivo/llm-core

Core LLM functionality with conversation history management, character prompt building, and state management for Charivo.

## Features

- 💬 **Conversation History** - Automatic message history management with sliding window
- 🎭 **Character Prompts** - Dynamic system prompt generation from character data
- 🔄 **State Management** - Stateful LLM session management
- 🔌 **Client Agnostic** - Works with any LLM client (OpenAI, Anthropic, custom, etc.)

## Installation

```bash
pnpm add @charivo/llm-core @charivo/core
```

## Usage

### Basic Setup

```typescript
import { createLLMManager } from "@charivo/llm-core";
import { OpenAILLMClient } from "@charivo/llm-client-openai";

// Create an LLM client
const client = new OpenAILLMClient({
  apiKey: "your-api-key",
  model: "gpt-4"
});

// Wrap with LLMManager for state management
const llmManager = createLLMManager(client);

// Set character
llmManager.setCharacter({
  id: "assistant",
  name: "Hiyori",
  personality: "Cheerful and helpful AI assistant",
  traits: ["friendly", "knowledgeable", "patient"],
  background: "A helpful AI assistant created to help users",
  instructions: [
    "Always be polite and respectful",
    "Provide clear and concise answers"
  ]
});

// Generate responses (conversation history managed automatically)
const response1 = await llmManager.generateResponse({
  id: "1",
  content: "Hello!",
  timestamp: new Date(),
  type: "user"
});

const response2 = await llmManager.generateResponse({
  id: "2",
  content: "How are you?",
  timestamp: new Date(),
  type: "user"
});
// Previous messages are automatically included in context
```

### With Conversation History Limit

```typescript
import { LLMManager } from "@charivo/llm-core";

const llmManager = new LLMManager(client, {
  maxHistoryMessages: 10 // Keep last 10 messages
});

llmManager.setCharacter(character);

// After 10 messages, oldest messages are automatically removed
```

### Custom LLM Client

```typescript
import { LLMClient, Message, Character } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";

class MyCustomLLMClient implements LLMClient {
  async call(messages: Array<{role: string, content: string}>): Promise<string> {
    // Call your LLM API
    const response = await fetch("https://my-llm-api.com/chat", {
      method: "POST",
      body: JSON.stringify({ messages })
    });
    const data = await response.json();
    return data.response;
  }
}

const llmManager = createLLMManager(new MyCustomLLMClient());
```

## API Reference

### `LLMManager`

Main class for managing LLM conversations.

#### Constructor

```typescript
new LLMManager(
  client: LLMClient,
  options?: { maxHistoryMessages?: number }
)
```

**Options:**
- `maxHistoryMessages?: number` - Maximum messages to keep in history (default: no limit)

#### Methods

##### `setCharacter(character)`
Set the active character for conversation.

```typescript
llmManager.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful",
  traits: ["friendly", "intelligent"],
  background: "A helpful AI assistant",
  instructions: ["Be polite", "Be concise"]
});
```

##### `generateResponse(message)`
Generate a response for a user message. Conversation history is managed automatically.

```typescript
const response = await llmManager.generateResponse({
  id: "1",
  content: "What's the weather?",
  timestamp: new Date(),
  type: "user"
});
```

##### `getHistory()`
Get the conversation history.

```typescript
const history = llmManager.getHistory();
```

##### `clearHistory()`
Clear the conversation history.

```typescript
llmManager.clearHistory();
```

### `CharacterPromptBuilder`

Utility for building system prompts from character data.

```typescript
import { CharacterPromptBuilder } from "@charivo/llm-core";

const prompt = CharacterPromptBuilder.buildSystemPrompt({
  id: "assistant",
  name: "Hiyori",
  personality: "Cheerful and helpful",
  traits: ["friendly", "knowledgeable"],
  background: "A helpful AI assistant",
  instructions: ["Be polite", "Be concise"]
});

console.log(prompt);
// "You are Hiyori. Your personality is: Cheerful and helpful.
//  Your traits: friendly, knowledgeable.
//  Background: A helpful AI assistant.
//  Please follow these instructions:
//  - Be polite
//  - Be concise"
```

## Character Configuration

The `Character` type supports rich configuration:

```typescript
interface Character {
  id: string;              // Unique identifier
  name: string;            // Character's name
  personality: string;     // Overall personality description
  traits?: string[];       // List of traits
  background?: string;     // Character's background story
  instructions?: string[]; // Behavioral instructions for the LLM
}
```

### Example Characters

#### Helpful Assistant

```typescript
{
  id: "assistant",
  name: "Hiyori",
  personality: "Cheerful, friendly, and always eager to help",
  traits: ["patient", "knowledgeable", "empathetic"],
  background: "A virtual assistant created to help users with their daily tasks",
  instructions: [
    "Always greet users warmly",
    "Provide clear and actionable advice",
    "Ask clarifying questions when needed"
  ]
}
```

#### Professional Advisor

```typescript
{
  id: "advisor",
  name: "Dr. Watson",
  personality: "Professional, analytical, and detail-oriented",
  traits: ["logical", "thorough", "objective"],
  background: "An AI advisor with expertise in business strategy",
  instructions: [
    "Maintain a professional tone",
    "Support advice with data and reasoning",
    "Consider multiple perspectives"
  ]
}
```

## Conversation Flow

```
User Message
     ↓
LLMManager receives message
     ↓
Add to conversation history
     ↓
CharacterPromptBuilder generates system prompt
     ↓
LLMClient sends to LLM API (with full history)
     ↓
Response returned
     ↓
Response added to history
     ↓
Return to user
```

## Architecture

```
LLMManager (stateful)
  ├─ Conversation History
  ├─ Character Management
  ├─ CharacterPromptBuilder
  └─ LLMClient (stateless)
      └─ Your LLM API
```

## Best Practices

1. **Set character before generating response**: Always call `setCharacter()` before starting a conversation
2. **Use maxHistoryMessages**: Limit history to prevent token overflow
3. **Include message types**: Use proper message types (user, character, system) for context
4. **Handle errors**: Wrap calls in try-catch for API errors

```typescript
try {
  const response = await llmManager.generateResponse("Hello");
} catch (error) {
  console.error("LLM error:", error);
  // Handle error (e.g., show error message to user)
}
```

## License

MIT
