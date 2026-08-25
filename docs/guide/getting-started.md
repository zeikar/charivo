---
title: Getting Started
sidebar_position: 2
---

# Getting Started

This is the shortest path to a working Charivo app with your vendor credentials
on the server, where a production app keeps them. If you just want to see a
character talk first, [Quick Try](#quick-try-dev-only) gets you there with an API
key and no server — but it is not what you ship.

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

## Quick Try (Dev Only)

To see a character talk before writing any server code, the `openai` subpaths ship
direct browser clients that call OpenAI straight from the page. They take your API
key and send it to the browser, so this path is for local experiments only.

**Never ship this.** Anyone who opens devtools can read the key. Once it works,
move to [Minimal Browser Setup](#minimal-browser-setup) and
[Minimal Server Routes](#minimal-server-routes) below, which keep the key on your
server. The rest of the app stays the same — only the client factories change.

```ts
import { createCharivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { createOpenAILLMClient } from "@charivo/llm/openai";
import { createTTSManager } from "@charivo/tts";
import { createOpenAITTSPlayer } from "@charivo/tts/openai";
import { createRenderManager } from "@charivo/render";
import { createLive2DRenderer } from "@charivo/render-live2d";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

const canvas = document.querySelector("canvas")!;

const renderManager = createRenderManager(createLive2DRenderer({ canvas }), {
  canvas,
});

await renderManager.initialize();
await renderManager.loadModel?.("/live2d/Hiyori/Hiyori.model3.json");

const charivo = createCharivo({
  renderer: renderManager,
  llm: createLLMManager(
    createOpenAILLMClient({ apiKey: OPENAI_API_KEY, model: "gpt-4.1-nano" }),
  ),
  tts: createTTSManager(createOpenAITTSPlayer({ apiKey: OPENAI_API_KEY })),
  character: {
    id: "hiyori",
    name: "Hiyori",
    personality: "Cheerful and helpful assistant",
    voice: { voiceId: "marin" },
  },
});

await charivo.userSay("Hello");
```

## Minimal Browser Setup

```ts
import { createCharivo, isCharivoError } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";
import { createTTSManager } from "@charivo/tts";
import { createRemoteTTSPlayer } from "@charivo/tts/remote";
import { createRenderManager } from "@charivo/render";
import { createLive2DRenderer } from "@charivo/render-live2d";

const canvas = document.querySelector("canvas")!;

const renderManager = createRenderManager(createLive2DRenderer({ canvas }), {
  canvas,
  mouseTracking: "document",
});

await renderManager.initialize();
await renderManager.loadModel?.("/live2d/Hiyori/Hiyori.model3.json");

const charivo = createCharivo({
  renderer: renderManager,
  llm: createLLMManager(createRemoteLLMClient({ apiEndpoint: "/api/chat" })),
  tts: createTTSManager(createRemoteTTSPlayer({ apiEndpoint: "/api/tts" })),
  character: {
    id: "hiyori",
    name: "Hiyori",
    personality: "Cheerful and helpful assistant",
    voice: { voiceId: "marin" },
  },
});

try {
  await charivo.userSay("Hello");
} catch (error) {
  if (isCharivoError(error)) {
    console.error(error.code, error.message);
  }
  throw error;
}

await charivo.dispose();
```

## Minimal Server Routes

Browser clients should call your own routes, not vendor APIs directly. The
routes below are Next.js route handlers matching what `/api/chat` and
`/api/tts` above expect.

They show the protocol shape and nothing more: they trust `messages`, `text`,
`voice`, and `speed` exactly as sent. Before one faces the internet, add
authentication, rate limiting, and bounds on the inputs you pay for — the demo's
[`chat-request.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/api/chat-request.ts)
and [`demo-limits.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/api/demo-limits.ts)
show what that adds up to.

LLM route (`/api/chat`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { createOpenAILLMProvider } from "@charivo/server/openai";

export async function POST(request: NextRequest) {
  const { messages } = await request.json();

  const provider = createOpenAILLMProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4.1-nano",
  });

  try {
    const message = await provider.generateResponse(messages);
    return NextResponse.json({ success: true, message });
  } catch (error) {
    console.error("LLM Provider Error:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 },
    );
  }
}
```

This minimal route covers plain chat. To let the model drive avatar
expressions and motions through tool calls, the route also needs to forward
`tools` to `generateResponseWithTools` — see the avatar tool-calling section
in the [LLM guide](./llm.md).

TTS route (`/api/tts`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { createOpenAITTSProvider } from "@charivo/server/openai";

export async function POST(request: NextRequest) {
  const { text, voice = "marin", speed = 1 } = await request.json();

  const provider = createOpenAITTSProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    defaultVoice: "marin",
    defaultModel: "gpt-4o-mini-tts",
  });

  try {
    const audio = await provider.generateSpeech(text, { voice, rate: speed });
    return new NextResponse(audio, {
      headers: { "Content-Type": "audio/wav" },
    });
  } catch (error) {
    console.error("TTS Provider Error:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 },
    );
  }
}
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

Charivo normalizes orchestration and runtime failures into typed errors from
`@charivo/core`. Prefer `isCharivoError(error)` or `error.code` checks over
parsing messages.

Not every throw is one: factory validation raises plain `TypeError`s (an
invalid `maxHistoryTurns`, for example), and renderers or third-party
implementations may throw ordinary `Error`s.

## Related Guides

- [Choosing Packages](./choosing-packages.md)
- [Rendering](./rendering.md)
- [LLM](./llm.md)
- [TTS](./tts.md)
