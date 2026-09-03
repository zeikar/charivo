---
title: Architecture
sidebar_position: 3
---

# Architecture

Charivo keeps a strict package boundary between orchestration, managers,
browser runtimes, and server providers. The rest of this guide walks through
that split and how to navigate the repo.

## Dependency Direction

The dependency flow is intentionally simple:

```text
App
  -> @charivo/core
  -> modality packages
  -> browser implementations via subpath exports
  -> optional server providers behind API routes
```

In practice:

- `@charivo/core` owns the `Charivo` orchestrator, shared types, and event bus
- modality packages own stateful feature logic
- browser runtime packages live on subpaths such as `@charivo/tts/remote` or `@charivo/realtime/openai`
- server providers live on `@charivo/server/*` subpaths, which keeps credential
  use and the realtime session bootstrap on the server side — see
  [Server Providers](#server-providers) for why most of them are implemented in
  the modality packages

Lower layers should not take on orchestration concerns from higher layers.

## Package Roles

### Core

- `@charivo/core`: orchestrator, shared contracts, event bus

### Manager Packages

- `@charivo/llm`: conversation lifecycle and message orchestration
- `@charivo/tts`: synthesis flow and lip-sync coordination
- `@charivo/stt`: recording and transcription lifecycle
- `@charivo/realtime`: realtime session state, tools, and in-place session updates
- `@charivo/render`: renderer lifecycle, mouse tracking, and visual bridge logic

Each manager wraps a runtime implementation behind a stable manager-facing API.

### Avatar Tool Extensions

- `@charivo/avatar` (optional): catalog-constrained avatar
  expression/motion/gaze tools, instructions, and a result projector, built on
  `@charivo/core`'s neutral `ToolRegistration`/`ToolResultProjector`
  contracts. It bridges tool results into both `@charivo/realtime` and
  `@charivo/llm`, adjacent to but separate from either manager package — see
  [Avatar Control](./avatar.md). (Formerly published as
  `@charivo/realtime-avatar`.)

## Public API Contract

Charivo's public surface is factory-first: components are consumed through
interfaces, not concrete classes.

- Pluggable managers, clients, players, transcribers, and renderers are
  created via `create*` factories (e.g. `createRemoteLLMClient`,
  `createOpenAITTSPlayer`) and consumed through their interfaces
  (`LLMManager`, `TTSPlayer`, `RenderManager`, ...). Concrete
  implementation classes such as `RemoteLLMClient`, `OpenAITTSPlayer`,
  `ConsoleRenderer`, `Live2DRendererImpl`, and the `*Manager`
  implementations are never exported from a public entry point.
- `Charivo` is the single top-level orchestrator: it owns the instance
  lifecycle — wiring managers together via `attach*`, holding the event bus,
  and owning `dispose()`. `createCharivo(options)` is the factory-first way in,
  attaching the managers you supply and applying the character last; it returns
  an ordinary instance, so late `attach*` calls work on it just as they do on a
  hand-constructed one. The class itself remains exported — a partial exception
  to the rule above — because it predates the factory and direct construction
  stays supported, not because the factory is limited to up-front wiring.
- `CharivoError` and its subclasses (`CharivoStateError`,
  `CharivoTimeoutError`, `CharivoTransportError`, `CharivoProviderError`,
  `CharivoDisposeError`) are a second intentional exception: an error
  *taxonomy* to check with `isCharivoError`/`error.code`, not a constructible
  component.
- The server provider classes (`OpenAILLMProvider`, `OpenClawLLMProvider`,
  `GeminiLLMProvider`, `OpenAITTSProvider`, `GeminiTTSProvider`,
  `OpenAISTTProvider`, `GeminiSTTProvider`, `OpenAIRealtimeProvider`,
  `GeminiRealtimeProvider`) are a third intentional exception, exported as
  concrete classes alongside their `create*Provider` factories: consumers rely
  on `instanceof` checks and on provider methods outside the narrow core
  interface (e.g. `OpenAITTSProvider.setModel`, absent from `TTSProvider`) — a
  contract `packages/server/__tests__/barrel.test.ts` pins. Separately, and not
  a "Node-only" restriction, the factories are also callable directly from a
  browser via `dangerouslyAllowBrowser`, letting a local app or test skip
  standing up a server. `@charivo/server/*` exports all nine for server use;
  the two realtime providers are implemented directly there instead of in a
  modality package (see Server Providers below).
- Subclassing `Charivo` is unsupported; extend it through composition
  (attach managers, listen to events) rather than inheritance.
- The concrete event bus implementation is internal; `CharivoEventBus` and
  `CharivoEventEmitter` are the contract other code depends on.

## Browser Runtime Packages

For most apps, start with remote packages and only use browser-direct packages
when you explicitly want local development shortcuts or zero-server behavior.

### LLM

- `@charivo/llm/remote`
- `@charivo/llm/openai` — also exports the `createOpenAILLMProvider` server-side provider
- `@charivo/llm/openclaw` — also exports the `createOpenClawLLMProvider` server-side provider
- `@charivo/llm/gemini` — also exports the `createGeminiLLMProvider` server-side provider
- `@charivo/llm/stub`

### TTS

- `@charivo/tts/remote`
- `@charivo/tts/openai` — also exports the `createOpenAITTSProvider` server-side provider
- `@charivo/tts/gemini` — also exports the `createGeminiTTSProvider` server-side provider
- `@charivo/tts/web`

### STT

- `@charivo/stt/remote`
- `@charivo/stt/openai` — also exports the `createOpenAISTTProvider` server-side provider
- `@charivo/stt/gemini` — also exports the `createGeminiSTTProvider` server-side provider
- `@charivo/stt/web`
- `@charivo/stt/openai-realtime` — streaming transcriber; the app supplies the
  bootstrap function that owns credentials

### Realtime

- `@charivo/realtime/remote`
- `@charivo/realtime/openai-agents`
- `@charivo/realtime/openai`
- `@charivo/realtime/gemini`

### Rendering

- `@charivo/render-live2d`
- `@charivo/render/stub`

## Server Providers

Provider packages belong behind your own API routes:

- `@charivo/server/openai`
- `@charivo/server/openclaw`
- `@charivo/server/gemini`

The LLM/TTS/STT providers under these subpaths are implemented in the
matching modality package (`@charivo/llm/openai`, `@charivo/llm/openclaw`,
`@charivo/llm/gemini`, `@charivo/tts/openai`, `@charivo/tts/gemini`,
`@charivo/stt/openai`, `@charivo/stt/gemini`) and re-exported here; only the
realtime providers — OpenAI (ephemeral client-secret minting) and Gemini Live
(single-use ephemeral tokens carrying the whole session config) — are
implemented directly in `@charivo/server`.

That placement is deliberate, not an inverted layering: each of those modality
subpaths also ships a dev/testing browser client that wraps the same provider
instead of duplicating an HTTP client, so the provider has to live where that
client can reuse it — which is why `@charivo/server/*` is mostly re-exports.
Fresh reviews have misread this twice; it has been examined and upheld both
times, so treat it as settled unless the dev-client path itself is being
removed.

## Event Wiring

Charivo intentionally keeps two event contracts:

- `RenderManager` uses `setEventBus(...)`
- `TTSManager`, `STTManager`, `RealtimeManager`, and `LLMManager` use
  `setEventEmitter(...)` (optional on `LLMManager`; wired only when it is
  attached via `Charivo.attachLLM(...)`)

This is deliberate.

- `RenderManager` subscribes to upstream events such as `tts:lipsync:update`, `avatar:expression`, `avatar:motion`, and `avatar:gaze`
- TTS, STT, realtime, and LLM managers mainly publish events back into core —
  for `LLMManager` that means `avatar:*`-style events from tool result
  projectors, not conversation events

Do not normalize these contracts unless the public manager API is being
redesigned.

## Recommended Integration Model

For production browser apps:

- LLM: `@charivo/llm` + `@charivo/llm/remote` + `@charivo/server/openai` or `@charivo/server/gemini`
- TTS: `@charivo/tts` + `@charivo/tts/remote` + `@charivo/server/openai` or `@charivo/server/gemini`
- STT: `@charivo/stt` + `@charivo/stt/remote` + `@charivo/server/openai` or `@charivo/server/gemini`
- Realtime: `@charivo/realtime` + `@charivo/realtime/remote` + `@charivo/server/openai` or `@charivo/server/gemini`

Direct browser vendor packages are mainly for development, demos, and testing.

Browser-native packages are a separate option:

- `@charivo/tts/web`
- `@charivo/stt/web`

Use them when you want browser-only speech features and can accept browser
support differences.

## Repository Layout

```text
packages/
  core/
  avatar/
  llm/
  tts/
  stt/
  realtime/
  render/
  render-live2d/
  render-iki/
  server/
examples/
  web/
  companion/
  iki-test/
docs/
  guide/
  history/
  images/
docs-site/
scripts/
```

- root `README.md`: project overview and top-level entry points
- `packages/`: library packages, publishable except private development
  adapters such as `@charivo/render-iki`
- `examples/`: the two documented reference apps — [web](./examples-web.md) puts
  the LLM/TTS/STT client styles side by side, [companion](./examples-companion.md)
  is realtime-only with browser-local character memory — plus `iki-test`, a
  private harness for the iki renderer adapter
- `docs-site/`: the site that publishes `docs/guide/`
- `docs/guide/`: integration guides and package selection help
- `docs/history/`: migrations, upgrade notes, and implementation history
- `scripts/`: repo tooling

## TypeScript Module Resolution

Charivo's public subpath imports require a module resolution mode that honors
package exports. Use one of:

- `moduleResolution: "bundler"`
- `moduleResolution: "node16"`
- `moduleResolution: "nodenext"`

## Related Guides

- [Choosing Packages](./choosing-packages.md)
- [Rendering](./rendering.md)
- [Examples Web](./examples-web.md)
