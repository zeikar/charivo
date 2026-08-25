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
  -> modality root package
  -> remote browser runtime package
  -> your API route
  -> server provider package
```

That means:

- `@charivo/core` orchestrates the app
- modality root packages such as `@charivo/llm`, `@charivo/tts`, and `@charivo/realtime` own feature state
- remote browser packages talk to your server
- server provider packages such as `@charivo/server/openai` keep credentials on the server

## Where To Start

New to the repo: read [Getting Started](./getting-started.md), then
[Choosing Packages](./choosing-packages.md) and
[Architecture](./architecture.md), then the subsystem guides you need.

For the quickest route to a working browser app, follow
[Getting Started](./getting-started.md), [Rendering](./rendering.md), and
[Examples Web](./examples-web.md).

To read the shipped reference apps:

- [Examples Web](./examples-web.md) — LLM/TTS/STT client styles side by side
  ([app README](https://github.com/zeikar/charivo/blob/main/examples/web/README.md))
- [Examples Companion](./examples-companion.md) — realtime-only, browser-local
  memory ([app README](https://github.com/zeikar/charivo/blob/main/examples/companion/README.md))

## Guide Map

- [Getting Started](./getting-started.md): minimal production-oriented setup
- [Architecture](./architecture.md): package boundaries, layering, and event wiring
- [Choosing Packages](./choosing-packages.md): remote vs browser-direct vs browser-native
- [Rendering](./rendering.md): `@charivo/render` and `@charivo/render-live2d`
- [LLM](./llm.md): conversation manager and client choices
- [TTS](./tts.md): speech playback and lip-sync wiring
- [STT](./stt.md): microphone recording and transcription paths
- [Realtime](./realtime.md): session-based voice interaction and tool wiring
- [Examples Web](./examples-web.md): Next.js reference app and API routes
- [Examples Companion](./examples-companion.md): realtime-only app with browser-local character memory

## Guide Docs vs Package READMEs

Use the guides for integration decisions, recommended stacks, and copy-paste
recipes.

Use package READMEs for package-local details such as exports, request
contracts, and provider-specific config:

- [core README](https://github.com/zeikar/charivo/blob/main/packages/core/README.md)
- [realtime README](https://github.com/zeikar/charivo/blob/main/packages/realtime/README.md)
- other package docs under [`packages/`](https://github.com/zeikar/charivo/tree/main/packages)
