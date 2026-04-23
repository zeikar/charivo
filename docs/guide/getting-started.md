---
title: Getting Started
sidebar_position: 2
---

# Getting Started

This is the shortest production-oriented path to a working Charivo app.

## Recommended Stack

Start with:

```text
@charivo/core
@charivo/llm + @charivo/llm/remote
@charivo/tts + @charivo/tts/remote
@charivo/render + @charivo/render-live2d
server routes backed by @charivo/server/* providers
```

This is the default browser setup across the repo. It keeps vendor credentials
on the server and leaves room to add STT or realtime later without changing the
overall shape of the app.

## Install

```bash
pnpm add \
  @charivo/core \
  @charivo/llm \
  @charivo/tts \
  @charivo/render @charivo/render-live2d
```

For the server side:

```bash
pnpm add \
  @charivo/server
```

## Minimal Browser Setup

```ts
import { Charivo, CharivoError } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";
import { createTTSManager } from "@charivo/tts";
import { createRemoteTTSPlayer } from "@charivo/tts/remote";
import { createRenderManager } from "@charivo/render";
import { createLive2DRenderer } from "@charivo/render-live2d";

const canvas = document.querySelector("canvas")!;

const charivo = new Charivo();

const renderer = createLive2DRenderer({ canvas });
const renderManager = createRenderManager(renderer, {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel("/live2d/Hiyori/Hiyori.model3.json");

charivo.attachRenderer(renderManager);
charivo.attachLLM(
  createLLMManager(createRemoteLLMClient({ apiEndpoint: "/api/chat" })),
);
charivo.attachTTS(
  createTTSManager(createRemoteTTSPlayer({ apiEndpoint: "/api/tts" })),
);

charivo.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
  voice: { voiceId: "marin" },
});

try {
  await charivo.userSay("Hello");
} catch (error) {
  if (error instanceof CharivoError) {
    console.error(error.code, error.message);
  }
  throw error;
}

await charivo.dispose();
```

## Minimal Server Routes

Browser clients should call your own routes, not vendor APIs directly.

LLM route:

```ts
import { createOpenAILLMProvider } from "@charivo/server/openai";

const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});

const text = await provider.generateResponse(messages);
```

TTS route:

```ts
import { createOpenAITTSProvider } from "@charivo/server/openai";

const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultVoice: "marin",
  defaultModel: "gpt-4o-mini-tts",
});

const audio = await provider.generateSpeech(text, {
  voice: "marin",
  rate: 1,
});
```

For a full Next.js example, see [Examples Web](./examples-web.md).

## TypeScript Note

If your app imports subpaths such as `@charivo/llm/remote`, use a TypeScript
module resolution mode that supports package exports:
`"bundler"`, `"node16"`, or `"nodenext"`.

## What You Get

- typed orchestration through `Charivo`
- character-aware LLM history management
- server-mediated TTS playback
- Live2D rendering with mouse tracking
- a clean path to add STT or realtime later

## Error Handling

Public Charivo APIs now throw typed errors from `@charivo/core`. Prefer
`instanceof CharivoError` or `error.code` checks instead of parsing messages.

## Related Guides

- [Choosing Packages](./choosing-packages.md)
- [Rendering](./rendering.md)
- [LLM](./llm.md)
- [TTS](./tts.md)
