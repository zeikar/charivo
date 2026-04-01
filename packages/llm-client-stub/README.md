# @charivo/llm-client-stub

Deterministic stub LLM client for tests and demos.

It returns canned responses in rotation and performs no network calls.

## Install

```bash
pnpm add @charivo/llm-client-stub
```

## Usage

```ts
import { createStubLLMClient } from "@charivo/llm-client-stub";

const client = createStubLLMClient();
const message = await client.call([
  { role: "user", content: "Hello" },
]);
```

Use this package when you want to validate UI or conversation flow without
depending on a provider.
