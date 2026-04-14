# Architecture

Charivo keeps a strict package boundary between orchestration, managers,
browser runtimes, and server providers. The rest of this guide walks through
that split and how to navigate the repo.

## Dependency Direction

The dependency flow is intentionally simple:

```text
App
  -> @charivo/core
  -> manager packages (*-core)
  -> browser implementations (client/player/transcriber/renderer)
  -> optional server providers behind API routes
```

In practice:

- `@charivo/core` owns the `Charivo` orchestrator, shared types, and event bus
- `*-core` packages own stateful feature logic
- browser runtime packages implement clients, players, transcribers, and renderers
- provider packages stay on the server and hold credentials

Lower layers should not take on orchestration concerns from higher layers.

## Package Roles

### Core

- `@charivo/core`: orchestrator, shared contracts, event bus
- `@charivo/shared`: lightweight shared utilities

### Manager Packages

- `@charivo/llm-core`: conversation lifecycle and message orchestration
- `@charivo/tts-core`: synthesis flow and lip-sync coordination
- `@charivo/stt-core`: recording and transcription lifecycle
- `@charivo/realtime-core`: realtime session state, tools, and reconnect-driven updates
- `@charivo/render-core`: renderer lifecycle, mouse tracking, and visual bridge logic

Each manager wraps a runtime implementation behind a stable manager-facing API.

## Browser Runtime Packages

For most apps, start with remote packages and only use browser-direct packages
when you explicitly want local development shortcuts or zero-server behavior.

### LLM

- `@charivo/llm-client-remote`
- `@charivo/llm-client-openai`
- `@charivo/llm-client-openclaw`
- `@charivo/llm-client-stub`

### TTS

- `@charivo/tts-player-remote`
- `@charivo/tts-player-openai`
- `@charivo/tts-player-web`

### STT

- `@charivo/stt-transcriber-remote`
- `@charivo/stt-transcriber-openai`
- `@charivo/stt-transcriber-web`

### Realtime

- `@charivo/realtime-client-remote`
- `@charivo/realtime-client-openai-agents`
- `@charivo/realtime-client-openai`

### Rendering

- `@charivo/render-live2d`
- `@charivo/render-stub`

## Server Providers

Provider packages belong behind your own API routes:

- `@charivo/llm-provider-openai`
- `@charivo/llm-provider-openclaw`
- `@charivo/tts-provider-openai`
- `@charivo/stt-provider-openai`
- `@charivo/realtime-provider-openai`

The default production shape is:

```text
browser app
  -> @charivo/core
  -> manager package
  -> remote browser runtime package
  -> your API route
  -> provider package
```

## Event Wiring

Charivo intentionally keeps two event contracts:

- `RenderManager` uses `setEventBus(...)`
- `TTSManager`, `STTManager`, and `RealtimeManager` use `setEventEmitter(...)`

This is deliberate.

- `RenderManager` subscribes to upstream events such as `tts:lipsync:update` and `realtime:emotion`
- TTS, STT, and realtime managers mainly publish events back into core

Do not normalize these contracts unless the public manager API is being
redesigned.

## Recommended Integration Model

For production browser apps:

- LLM: `@charivo/llm-core` + `@charivo/llm-client-remote` + `@charivo/llm-provider-openai`
- TTS: `@charivo/tts-core` + `@charivo/tts-player-remote` + `@charivo/tts-provider-openai`
- STT: `@charivo/stt-core` + `@charivo/stt-transcriber-remote` + `@charivo/stt-provider-openai`
- Realtime: `@charivo/realtime-core` + `@charivo/realtime-client-remote` + `@charivo/realtime-provider-openai`

Direct browser vendor packages are mainly for development, demos, and testing.

Browser-native packages are a separate option:

- `@charivo/tts-player-web`
- `@charivo/stt-transcriber-web`

Use them when you want browser-only speech features and can accept browser
support differences.

## Repository Layout

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

- `packages/`: publishable library packages
- `examples/web/`: reference app
- `docs/guide/`: user-facing integration guides
- `docs/adr/`: design decisions and policy
- `docs/history/`: upgrade notes and implementation history
- `scripts/`: repo tooling

## Documentation Split

- root `README.md`: project overview and top-level entry points
- `docs/guide/`: integration guides and package selection help
- `docs/adr/`: architectural decisions
- `docs/history/`: migrations and historical notes

## Related Guides

- [Choosing Packages](./choosing-packages.md)
- [Rendering](./rendering.md)
- [Examples Web](./examples-web.md)
