# Getting Started

This guide answers one question: what is the shortest production-oriented path
to a working Charivo browser app?

Use it when you want a minimal setup with:

- `@charivo/core`
- remote LLM and TTS
- `@charivo/render-core`
- `@charivo/render-live2d`

## Recommended Default

For a browser app, start with this stack:

```text
@charivo/core
@charivo/llm-core + @charivo/llm-client-remote
@charivo/tts-core + @charivo/tts-player-remote
@charivo/render-core + @charivo/render-live2d
server routes backed by provider packages
```

This keeps credentials on the server and matches the current production
recommendation across the repo.

## Install

```bash
pnpm add \
  @charivo/core \
  @charivo/llm-core @charivo/llm-client-remote \
  @charivo/tts-core @charivo/tts-player-remote \
  @charivo/render-core @charivo/render-live2d
```

For the server side you also need provider packages:

```bash
pnpm add \
  @charivo/llm-provider-openai \
  @charivo/tts-provider-openai
```

## Browser App

Create a `Charivo` instance, attach the renderer, then attach the managers:

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

## Server Routes

Your browser clients should call your own routes, not vendor APIs directly.

Minimal LLM route:

```ts
import { createOpenAILLMProvider } from "@charivo/llm-provider-openai";

const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});

const text = await provider.generateResponse(messages);
```

Minimal TTS route:

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

For a working Next.js reference, read [Examples Web](./examples-web.md).

## What This Setup Gives You

- typed orchestration through `Charivo`
- character-aware LLM history management
- server-mediated TTS playback
- Live2D rendering with mouse tracking
- a path that can expand later to STT and realtime without changing the overall layering

## When To Pick Something Else

- Add [STT](./stt.md) when you want microphone input with turn-based transcription.
- Add [Realtime](./realtime.md) when you want live voice sessions instead of turn-based chat.
- Read [Choosing Packages](./choosing-packages.md) if you are deciding between remote, browser-direct, or browser-native modes.

## Next Steps

- [Choosing Packages](./choosing-packages.md)
- [Rendering](./rendering.md)
- [LLM](./llm.md)
- [TTS](./tts.md)
