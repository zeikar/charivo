---
title: Guide Index
slug: /
sidebar_position: 1
---

# Guide Index

Build Live2D AI characters that talk, react, and look at you.

Charivo is a modular TypeScript framework for voice, expression, motion, gaze,
and real-time conversation — split into focused packages.

These guides are for integrators building an app on top of Charivo. Use them
to choose the right packages, understand the layering, and get to a working
setup quickly.

## Default Stack

For most browser apps, the default stack looks like this:

```text
browser app
  -> @charivo/core
  -> manager package
  -> remote browser runtime package
  -> your API route
  -> provider package
```

That means:

- `@charivo/core` orchestrates the app
- `*-core` packages own feature state
- remote browser packages talk to your server
- provider packages keep credentials on the server

## Reading Order

If you are new to the repo, read in this order:

1. [Getting Started](./getting-started.md)
2. [Choosing Packages](./choosing-packages.md)
3. [Architecture](./architecture.md)
4. the subsystem guides you need

## Common Paths

### Quickest route to a working browser app

- [Getting Started](./getting-started.md)
- [Rendering](./rendering.md)
- [Examples Web](./examples-web.md)

### Choosing packages before wiring the app

- [Choosing Packages](./choosing-packages.md)
- [Architecture](./architecture.md)
- [LLM](./llm.md)
- [TTS](./tts.md)
- [STT](./stt.md)
- [Realtime](./realtime.md)

### Reading the shipped reference app

- [Examples Web](./examples-web.md)
- [examples/web README](https://github.com/zeikar/charivo/blob/main/examples/web/README.md)

## Guide Map

- [Getting Started](./getting-started.md): minimal production-oriented setup
- [Architecture](./architecture.md): package boundaries, layering, and event wiring
- [Choosing Packages](./choosing-packages.md): remote vs browser-direct vs browser-native
- [Rendering](./rendering.md): `render-core` and `render-live2d`
- [LLM](./llm.md): conversation manager and client choices
- [TTS](./tts.md): speech playback and lip-sync wiring
- [STT](./stt.md): microphone recording and transcription paths
- [Realtime](./realtime.md): session-based voice interaction and tool wiring
- [Examples Web](./examples-web.md): Next.js reference app and API routes

## Guide Docs vs Package READMEs

Use the guides for integration decisions, recommended stacks, and copy-paste
recipes.

Use package READMEs for package-local details such as exports, request
contracts, and provider-specific config:

- [core README](https://github.com/zeikar/charivo/blob/main/packages/core/README.md)
- [realtime-client-openai-agents README](https://github.com/zeikar/charivo/blob/main/packages/realtime-client-openai-agents/README.md)
- other package docs under [`packages/`](https://github.com/zeikar/charivo/tree/main/packages)
