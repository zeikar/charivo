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
- server providers live on `@charivo/server/*` subpaths and hold credentials

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

## Browser Runtime Packages

For most apps, start with remote packages and only use browser-direct packages
when you explicitly want local development shortcuts or zero-server behavior.

### LLM

- `@charivo/llm/remote`
- `@charivo/llm/openai`
- `@charivo/llm/openclaw`
- `@charivo/llm/stub`

### TTS

- `@charivo/tts/remote`
- `@charivo/tts/openai`
- `@charivo/tts/web`

### STT

- `@charivo/stt/remote`
- `@charivo/stt/openai`
- `@charivo/stt/web`

### Realtime

- `@charivo/realtime/remote`
- `@charivo/realtime/openai-agents`
- `@charivo/realtime/openai`

### Rendering

- `@charivo/render-live2d`
- `@charivo/render/stub`

## Server Providers

Provider packages belong behind your own API routes:

- `@charivo/server/openai`
- `@charivo/server/openclaw`

The default production shape is:

```text
browser app
  -> @charivo/core
  -> modality root package
  -> remote browser runtime package
  -> your API route
  -> server provider package
```

## Event Wiring

Charivo intentionally keeps two event contracts:

- `RenderManager` uses `setEventBus(...)`
- `TTSManager`, `STTManager`, and `RealtimeManager` use `setEventEmitter(...)`

This is deliberate.

- `RenderManager` subscribes to upstream events such as `tts:lipsync:update`, `realtime:expression`, `realtime:motion`, and `realtime:gaze`
- TTS, STT, and realtime managers mainly publish events back into core

Do not normalize these contracts unless the public manager API is being
redesigned.

## Recommended Integration Model

For production browser apps:

- LLM: `@charivo/llm` + `@charivo/llm/remote` + `@charivo/server/openai`
- TTS: `@charivo/tts` + `@charivo/tts/remote` + `@charivo/server/openai`
- STT: `@charivo/stt` + `@charivo/stt/remote` + `@charivo/server/openai`
- Realtime: `@charivo/realtime` + `@charivo/realtime/remote` + `@charivo/server/openai`

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
  llm/
  tts/
  stt/
  realtime/
  render/
  render-live2d/
  server/
examples/
  web/
docs/
  guide/
  history/
  images/
scripts/
```

- `packages/`: publishable library packages
- `examples/web/`: reference app
- `docs/guide/`: user-facing integration guides
- `docs/history/`: upgrade notes and implementation history
- `scripts/`: repo tooling

## Documentation Split

- root `README.md`: project overview and top-level entry points
- `docs/guide/`: integration guides and package selection help
- `docs/history/`: migrations and historical notes

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
