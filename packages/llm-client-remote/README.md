# @charivo/llm-client-remote

Remote HTTP LLM client for Charivo (client-side).

## Features

- 🔐 **Secure** - API keys stay on server
- 🌐 **HTTP-based** - Works with any server endpoint
- 🎯 **Type-Safe** - Full TypeScript support
- 🔌 **Flexible** - Use any LLM provider on the backend

## Installation

```bash
pnpm add @charivo/llm-client-remote @charivo/core
```

## Usage

### Client-side Setup

```typescript
import { createRemoteLLMClient } from "@charivo/llm-client-remote";
import { createLLMManager } from "@charivo/llm-core";

const client = createRemoteLLMClient({
  apiEndpoint: "/api/chat" // Your server endpoint
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

### Server-side Implementation (Required)

Use `@charivo/llm-provider-openai` for easy setup:

```typescript
// app/api/chat/route.ts (Next.js)
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
    return NextResponse.json(
      { error: "Chat failed" },
      { status: 500 }
    );
  }
}
```

## API Reference

### Constructor

```typescript
new RemoteLLMClient(config: RemoteLLMConfig)
```

### Configuration Options

```typescript
interface RemoteLLMConfig {
  /** Server API endpoint (default: "/api/chat") */
  apiEndpoint?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}
```

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
    { id: "1", content: "Hello!", timestamp: new Date(), type: "user" }
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

## Complete Example

### Client (React)

```typescript
import { Charivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";

function App() {
  const [charivo] = useState(() => {
    const charivo = new Charivo();
    
    const client = createRemoteLLMClient({
      apiEndpoint: "/api/chat"
    });
    const llmManager = createLLMManager(client);
    
    charivo.attachLLM(llmManager);
    charivo.setCharacter({
      id: "hiyori",
      name: "Hiyori",
      personality: "Cheerful AI assistant"
    });
    
    return charivo;
  });

  const handleSend = async (message: string) => {
    const response = await charivo.sendMessage(message);
    console.log(response);
  };

  return <ChatUI onSend={handleSend} />;
}
```

### Server (Next.js API Route)

```typescript
// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
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

## Why Use Remote Client?

### Security ✅
- API keys never exposed to client
- Server-side authentication
- Rate limiting per user

### Flexibility ✅
- Switch LLM providers without client changes
- Server-side prompt engineering
- Response caching and optimization
- Custom business logic

### Cost Control ✅
- Monitor and limit API usage
- Implement quotas per user
- Cache common responses
- Optimize token usage

## Error Handling

```typescript
try {
  const response = await client.chat(messages);
} catch (error) {
  if (error.response?.status === 429) {
    console.error("Rate limit exceeded");
  } else if (error.response?.status === 500) {
    console.error("Server error");
  } else {
    console.error("Chat failed:", error);
  }
}
```

## Custom Backend

You can use any backend that returns a response:

```typescript
// Your custom API
export async function POST(request: Request) {
  const { messages } = await request.json();
  
  // Call any LLM API (Anthropic, Cohere, etc.)
  const response = await yourLLMAPI.chat(messages);
  
  return Response.json({ response });
}
```

## Related Packages

- [`@charivo/llm-provider-openai`](../llm-provider-openai) - Server-side OpenAI provider
- [`@charivo/llm-client-openai`](../llm-client-openai) - Direct OpenAI client (not recommended for production)
- [`@charivo/llm-core`](../llm-core) - LLM core functionality

## License

MIT
