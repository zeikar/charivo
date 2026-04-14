# Architecture Guide

This guide answers one question: how is Charivo structured, and where should
each piece live?

Use it when you are integrating multiple packages and want to understand the
current boundaries before wiring your app.

Recommended reading order:

1. [Guide Index](./index.md)
2. [Getting Started](./getting-started.md)
3. [Choosing Packages](./choosing-packages.md)
4. this page

## Design Rule

Charivo keeps a consistent dependency direction:

```text
App
  -> @charivo/core
  -> manager packages (*-core)
  -> browser implementations (client/player/transcriber/renderer)
  -> optional server providers behind API routes
```

That layering is intentional and should stay visible in app code.

- `@charivo/core` owns the orchestrator, shared domain types, and the event bus.
- `*-core` packages own stateful feature managers such as LLM, TTS, STT, realtime, and rendering.
- Browser packages implement runtime-facing capabilities such as clients, players, transcribers, and renderers.
- Provider packages stay on the server side and hold credentials or provider-specific backend logic.

The practical rule is simple: higher layers can depend on lower layers, but
lower layers should not reach back upward and take on orchestration concerns.

If you are building a browser app, the default mental model is:

- `@charivo/core` wires the experience together
- manager packages own session and feature state
- browser runtime packages do the actual work in the client
- provider packages sit behind your API routes

## Package Roles

### Core

- `@charivo/core`: the `Charivo` orchestrator, shared contracts, and event bus
- `@charivo/shared`: lightweight shared utilities

### Manager Packages

Manager packages are the stateful control layer.

- `@charivo/llm-core`: conversation lifecycle and message orchestration
- `@charivo/tts-core`: synthesis session flow and lip-sync coordination
- `@charivo/stt-core`: recording and transcription lifecycle
- `@charivo/realtime-core`: realtime session state, tools, and reconnect-driven session updates
- `@charivo/render-core`: renderer lifecycle, mouse tracking, and bridge logic for visual updates

Each manager wraps a runtime implementation behind a stable manager-facing API.

## Runtime Implementations

These packages run in the browser and plug into managers.

For most apps, prefer the remote/browser split first and only reach for
browser-direct packages when you explicitly want local development shortcuts or
zero-server behavior.

### LLM

- `@charivo/llm-client-remote`: calls your server route
- `@charivo/llm-client-openai`: direct browser OpenAI client for development and testing
- `@charivo/llm-client-openclaw`: direct browser OpenClaw client for development and testing
- `@charivo/llm-client-stub`: canned responses for tests and demos

### TTS

- `@charivo/tts-player-remote`: browser player backed by a server route
- `@charivo/tts-player-openai`: direct browser OpenAI TTS for development and testing
- `@charivo/tts-player-web`: Web Speech API implementation

### STT

- `@charivo/stt-transcriber-remote`: browser transcriber backed by a server route
- `@charivo/stt-transcriber-openai`: direct browser OpenAI STT for development and testing
- `@charivo/stt-transcriber-web`: Web Speech API implementation

### Realtime

- `@charivo/realtime-client-remote`: adapter-dispatched browser client for server realtime routes
- `@charivo/realtime-client-openai-agents`: OpenAI Agents SDK realtime transport client and adapter
- `@charivo/realtime-client-openai`: legacy low-level OpenAI realtime transport client and adapter

### Rendering

- `@charivo/render-live2d`: Live2D Cubism renderer
- `@charivo/render-stub`: no-op or console-oriented renderer for tests and demos

## Server Providers

Provider packages stay behind your own API routes.

- `@charivo/llm-provider-openai`
- `@charivo/llm-provider-openclaw`
- `@charivo/tts-provider-openai`
- `@charivo/stt-provider-openai`
- `@charivo/realtime-provider-openai`

Use these when you want production-safe deployment with credentials kept on the
server.

The default production shape looks like this:

```text
browser app
  -> @charivo/core
  -> manager package
  -> remote browser runtime package
  -> your API route
  -> provider package
```

## Event Wiring

Charivo intentionally keeps two related but different event contracts:

- `RenderManager` uses `setEventBus(...)`
- `TTSManager`, `STTManager`, and `RealtimeManager` use `setEventEmitter(...)`

This is not an inconsistency to clean up. It reflects different responsibilities.

- `RenderManager` subscribes to upstream events and therefore needs the full event bus contract.
- TTS, STT, and realtime managers mostly publish lifecycle and output events back into core, so they only need the emitter subset.

If you are adding packages or extending the system, preserve this split unless
you are intentionally redesigning the public manager contract.

## Recommended Integration Model

For production, the default recommendation is:

```text
browser app
  -> @charivo/core
  -> manager package
  -> remote browser runtime package
  -> your API route
  -> provider package
  -> upstream model vendor
```

Examples:

- LLM: `@charivo/llm-core` + `@charivo/llm-client-remote` + `@charivo/llm-provider-openai`
- TTS: `@charivo/tts-core` + `@charivo/tts-player-remote` + `@charivo/tts-provider-openai`
- STT: `@charivo/stt-core` + `@charivo/stt-transcriber-remote` + `@charivo/stt-provider-openai`
- Realtime: `@charivo/realtime-core` + `@charivo/realtime-client-remote` + `@charivo/realtime-provider-openai`

Direct browser vendor packages are mainly for local development, demos, and
testing.

Browser-native packages are a separate category:

- `@charivo/tts-player-web`
- `@charivo/stt-transcriber-web`

They are useful when you want zero-server browser features and can accept
browser support differences.

## Repository Layout

At the repo level, the structure is intentionally simple:

```text
packages/
  core/
  shared/
  llm-*/
  tts-*/
  stt-*/
  realtime-*/
  render-*/
examples/
  web/
docs/
  guide/
  adr/
  history/
  images/
scripts/
```

Use these directories as follows:

- `packages/`: publishable library packages
- `examples/web/`: the demo and integration reference app
- `docs/guide/`: user-facing guides
- `docs/adr/`: architectural decisions and policy records
- `docs/history/`: upgrade notes and change narratives
- `scripts/`: repository tooling and maintenance scripts

## Documentation Split

Use this rule of thumb:

- Add quick orientation, installation, and top-level links to the root `README.md`
- Add user-facing walkthroughs and conceptual docs to `docs/guide/`
- Add internal design decisions or policy documents to `docs/adr/`
- Add migration stories or implementation history to `docs/history/`

That keeps the root README short while still giving the project a proper
documentation surface like other open source libraries.

## Next Steps

- Read [Choosing Packages](./choosing-packages.md) if you are still deciding between remote, browser-direct, and browser-native paths.
- Read [Rendering](./rendering.md) if you are starting from a Live2D app shell.
- Read [Examples Web](./examples-web.md) for the shipped integration reference app.
