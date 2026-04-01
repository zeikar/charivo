# Charivo

Charivo is a modular TypeScript framework for interactive character apps.
It separates orchestration, stateful managers, browser-side clients, and
server-side providers so you can swap pieces without rewriting the whole stack.

Live demo: https://charivo.vercel.app/

![Charivo Demo](./docs/images/screenshot.png)

## Architecture

Charivo follows one rule consistently:

- `@charivo/core` owns shared domain types, the event bus, and the `Charivo` orchestrator.
- `*-core` packages own stateful manager logic.
- `*-client`, `*-player`, and `*-transcriber` packages run in the browser.
- `*-provider` packages are the server-side implementations that hold credentials.

That gives you a clean layering:

```text
App
  -> @charivo/core
  -> manager packages (*-core)
  -> browser implementations (client/player/transcriber/renderer)
  -> optional server providers behind API routes
```

## Quick Start

```bash
pnpm add \
  @charivo/core \
  @charivo/llm-core @charivo/llm-client-remote \
  @charivo/tts-core @charivo/tts-player-remote \
  @charivo/render-core @charivo/render-live2d
```

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
await renderManager.loadModel?.("/live2d/hiyori/hiyori.model3.json");

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

For a complete app, see [`examples/web`](./examples/web).

## Production vs Testing

Use the remote/server-mediated path by default:

- LLM: `@charivo/llm-client-remote` + a server route using a provider package
- TTS: `@charivo/tts-player-remote` + `@charivo/tts-provider-openai`
- STT: `@charivo/stt-transcriber-remote` + `@charivo/stt-provider-openai`
- Realtime: `@charivo/realtime-client-openai` + a server `/api/realtime` route

Keep the direct browser packages for local development, demos, and testing only:

- `@charivo/llm-client-openai`
- `@charivo/llm-client-openclaw`
- `@charivo/tts-player-openai`
- `@charivo/stt-transcriber-openai`

Browser-native packages are useful when you explicitly want no server dependency:

- `@charivo/tts-player-web`
- `@charivo/stt-transcriber-web`

## Package Map

Core:

- `@charivo/core`: orchestrator, event bus, domain types
- `@charivo/shared`: small shared utilities

LLM:

- `@charivo/llm-core`: stateful conversation manager
- `@charivo/llm-client-remote`: browser client for server API routes
- `@charivo/llm-client-openai`: direct OpenAI browser client, dev/testing only
- `@charivo/llm-client-openclaw`: direct OpenClaw browser client, dev/testing only
- `@charivo/llm-client-stub`: canned responses for tests and demos
- `@charivo/llm-provider-openai`: server-side OpenAI provider
- `@charivo/llm-provider-openclaw`: server-side OpenClaw provider

TTS:

- `@charivo/tts-core`: TTS session manager and lip-sync coordination
- `@charivo/tts-player-remote`: browser player for server TTS routes
- `@charivo/tts-player-openai`: direct OpenAI browser player, dev/testing only
- `@charivo/tts-player-web`: Web Speech API player
- `@charivo/tts-provider-openai`: server-side OpenAI TTS provider

STT:

- `@charivo/stt-core`: STT session manager and recording helper
- `@charivo/stt-transcriber-remote`: browser transcriber for server STT routes
- `@charivo/stt-transcriber-openai`: direct OpenAI browser transcriber, dev/testing only
- `@charivo/stt-transcriber-web`: Web Speech API transcriber
- `@charivo/stt-provider-openai`: server-side OpenAI STT provider

Realtime:

- `@charivo/realtime-core`: session manager, typed session config, emotion tool helpers
- `@charivo/realtime-client-openai`: OpenAI Realtime WebRTC client through a server endpoint

Rendering:

- `@charivo/render-core`: render manager, mouse tracking, lip-sync bridge
- `@charivo/render-live2d`: Live2D Cubism renderer
- `@charivo/render-stub`: console renderer for tests and demos

## Validation

From the repo root:

```bash
pnpm verify
pnpm pack:check
```

- `pnpm verify` runs build, test, typecheck, lint, and format checks.
- `pnpm pack:check` validates public package manifests and dry-run package contents.

## Release Checklist

Release guidance lives in [`docs/release-checklist.md`](./docs/release-checklist.md).
That checklist includes verification commands, docs sync, pack dry-runs, and the
Live2D SDK license review step.

## Live2D Note

`@charivo/render-live2d` vendors parts of the Live2D Cubism SDK for Web.
If you ship or republish that package, review the Live2D license terms before release.
