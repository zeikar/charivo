# Charivo

Build Live2D AI characters that talk, react, and look at you.

Charivo is a modular TypeScript framework for voice, expression, motion, gaze,
and real-time conversation. It separates orchestration, stateful managers,
browser-side clients, and server-side providers so you can swap pieces without
rewriting the whole stack.

Live demo: https://charivo.vercel.app/

![Charivo Demo](./docs/images/screenshot.png)

Documentation:

- [https://zeikar.github.io/charivo/](https://zeikar.github.io/charivo/)
- [ROADMAP.md](./ROADMAP.md): Amadeus-oriented product and technical roadmap

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

## Repo Layout

```text
packages/
  core/ shared/
  *-core/
  *-client-* | *-player-* | *-transcriber-* | render-*/
  *-provider-*/
examples/web/
docs/
  guide/ adr/ history/ images/
```


## Event Wiring

Charivo keeps two event contracts on purpose:

- `CharivoEventBus`: the full subscribe-and-emit contract
- `CharivoEventEmitter`: the emit-only subset

`RenderManager` keeps `setEventBus(...)` because it subscribes to upstream
events such as `tts:audio:start`, `tts:audio:end`, `tts:lipsync:update`,
`realtime:expression`, `realtime:motion`, and `realtime:gaze`.

`TTSManager`, `STTManager`, and `RealtimeManager` keep `setEventEmitter(...)`
because they primarily publish lifecycle and output events back into core.

This split is intentional. Do not normalize both contracts into one unless the
public manager contract is being redesigned.

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

For a complete app, see [`examples/web`](./examples/web).

## Production vs Testing

Use the remote/server-mediated path by default:

- LLM: `@charivo/llm-client-remote` + a server route using a provider package such as `@charivo/llm-provider-openai` or `@charivo/llm-provider-openclaw`
- TTS: `@charivo/tts-player-remote` + `@charivo/tts-provider-openai`
- STT: `@charivo/stt-transcriber-remote` + `@charivo/stt-provider-openai`
- Realtime: `@charivo/realtime-client-remote` + a server route using a provider package such as `@charivo/realtime-provider-openai`

Keep the direct browser packages for local development, demos, and testing only:

- `@charivo/llm-client-openai`
- `@charivo/llm-client-openclaw`
- `@charivo/realtime-client-openai`
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

- `@charivo/realtime-core`: provider-agnostic realtime manager, tool registry, typed state, and session config helpers
  Supports explicit `updateSession(...)` refresh via reconnect.
- `@charivo/realtime-client-remote`: adapter-dispatched browser client for server realtime routes
- `@charivo/realtime-client-openai-agents`: OpenAI Agents SDK realtime transport client and adapter
- `@charivo/realtime-client-openai`: legacy low-level OpenAI realtime transport client and adapter
- `@charivo/realtime-provider-openai`: server-side OpenAI realtime session provider

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

## Decision Records

Package output policy is recorded in
[`docs/adr/0001-package-output-strategy.md`](./docs/adr/0001-package-output-strategy.md).

## Versioning And Release Flow

Charivo uses Changesets for package versioning and npm publishing.

When a change should result in a published package update:

1. Add or update the code change.
2. Run `pnpm changeset`.
3. Select only the publishable packages that should be bumped.
4. Choose the correct bump level: `patch`, `minor`, or `major`.
5. Commit the generated `.changeset/*.md` file with the code change.
6. Push to `main`.
7. The release workflow opens a `chore: release packages` PR.
8. Merge that release PR to publish the new versions to npm.

Rules of thumb:

- Add a changeset when public package behavior, package metadata, dependencies, or public types change.
- Do not add a changeset for docs-only or demo-only changes that should not publish packages.
- `minor` is appropriate for new public API surface or contract changes.
- `patch` is appropriate for fixes, packaging corrections, and non-breaking behavior updates.

For release PR review rules, changeset examples, and publish-failure checks, use
[`docs/release-checklist.md`](./docs/release-checklist.md).

Repository requirements for the automated release flow:

- `NPM_TOKEN` must be configured in GitHub repository secrets.
- GitHub Actions must be allowed to create pull requests.

## Release Checklist

Detailed release guidance lives in
[`docs/release-checklist.md`](./docs/release-checklist.md). That checklist
includes verification commands, release PR review, pack dry-runs, and the
Live2D SDK license review step.

## Live2D Note

`@charivo/render-live2d` vendors parts of the Live2D Cubism SDK for Web.
If you ship or republish that package, review the Live2D license terms before release.
