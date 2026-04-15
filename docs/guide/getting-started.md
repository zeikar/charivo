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
@charivo/llm-core + @charivo/llm-client-remote
@charivo/tts-core + @charivo/tts-player-remote
@charivo/render-core + @charivo/render-live2d
server routes backed by provider packages
```

This is the default browser setup across the repo. It keeps vendor credentials
on the server and leaves room to add STT or realtime later without changing the
overall shape of the app.

## Install

```bash
pnpm add \
  @charivo/core \
  @charivo/llm-core @charivo/llm-client-remote \
  @charivo/tts-core @charivo/tts-player-remote \
  @charivo/render-core @charivo/render-live2d
```

For the server side:

```bash
pnpm add \
  @charivo/llm-provider-openai \
  @charivo/tts-provider-openai
```

## Minimal Browser Setup

```ts
import { Charivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";
import { createTTSManager } from "@charivo/tts-core";
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";
import { createRenderManager } from "@charivo/render-core";
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

await charivo.userSay("Hello");
```

## Minimal Server Routes

Browser clients should call your own routes, not vendor APIs directly.

LLM route:

```ts
import { createOpenAILLMProvider } from "@charivo/llm-provider-openai";

const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});

const text = await provider.generateResponse(messages);
```

TTS route:

```ts
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

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

## What You Get

- typed orchestration through `Charivo`
- character-aware LLM history management
- server-mediated TTS playback
- Live2D rendering with mouse tracking
- a clean path to add STT or realtime later

## Related Guides

- [Choosing Packages](./choosing-packages.md)
- [Rendering](./rendering.md)
- [LLM](./llm.md)
- [TTS](./tts.md)
