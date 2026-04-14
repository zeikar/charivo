# Guide Index

This guide answers one question: where should you start if you want to use
Charivo in a real app?

Charivo is a modular TypeScript framework for Live2D AI characters with LLM,
TTS, STT, realtime voice, and rendering kept in separate packages.

For most teams, the recommended learning path is:

1. [Getting Started](./getting-started.md)
2. [Choosing Packages](./choosing-packages.md)
3. [Architecture](./architecture.md)
4. subsystem guides for the parts you need

## Start Here

If you want the shortest path to a working browser app:

- use `@charivo/core` as the orchestrator
- use `*-core` managers for stateful behavior
- use remote browser packages by default
- keep provider packages behind your own API routes
- use `@charivo/render-live2d` with `@charivo/render-core` for Live2D rendering

That default production shape is:

```text
browser app
  -> @charivo/core
  -> manager package
  -> remote browser runtime package
  -> your API route
  -> provider package
```

## Reading Paths

### I want the quickest working setup

- [Getting Started](./getting-started.md)
- [Rendering](./rendering.md)
- [Examples Web](./examples-web.md)

### I need to choose the right packages first

- [Choosing Packages](./choosing-packages.md)
- [Architecture](./architecture.md)
- [LLM](./llm.md)
- [TTS](./tts.md)
- [STT](./stt.md)
- [Realtime](./realtime.md)

### I want the shipped integration reference

- [Examples Web](./examples-web.md)
- [examples/web README](../../examples/web/README.md)

## Guide Map

- [Getting Started](./getting-started.md): fastest copy-paste path for a basic character app
- [Architecture](./architecture.md): layering, event split, and repo layout
- [Choosing Packages](./choosing-packages.md): remote vs browser-direct vs browser-native decisions
- [Rendering](./rendering.md): `render-core` and `render-live2d`
- [LLM](./llm.md): conversation manager and client choices
- [TTS](./tts.md): playback paths and lip-sync wiring
- [STT](./stt.md): recording and transcription paths
- [Realtime](./realtime.md): session-based voice interaction and tool wiring
- [Examples Web](./examples-web.md): Next.js reference app and API routes

## Reference Split

Use the guide docs for integration decisions and copy-paste recipes.

Use package READMEs for package-local details such as exports, request
contracts, or provider-specific config:

- [core README](../../packages/core/README.md)
- [realtime-client-openai-agents README](../../packages/realtime-client-openai-agents/README.md)
- any other package in [`packages/`](../../packages)
