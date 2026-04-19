---
title: Examples Web
sidebar_position: 10
---

# Examples Web

`examples/web` is the reference Next.js app for the Charivo workspace. Read it
as the current integration example, not just a demo.

## What It Covers

The app exercises the current package stack:

- Live2D rendering through `@charivo/render-live2d` and `@charivo/render`
- LLM chat through remote, direct, OpenClaw proxy, and stub clients
- TTS through remote, browser-native, and direct OpenAI players
- STT through remote, browser-native, and direct OpenAI transcribers
- realtime voice sessions through `@charivo/realtime/remote` and `/api/realtime`

## Lifecycle Split

The current hook split is deliberate:

- `useLive2D` owns canvas mount and unmount
- `useCharivoChat` owns Charivo setup, manager attachment, event subscription, and teardown

This keeps renderer lifecycle separate from conversation and session lifecycle.

## API Routes

The current reference app ships:

- `POST /api/chat`
  Uses `@charivo/server/openai` with model `gpt-4.1-nano`
- `POST /api/chat-openclaw`
  Uses `@charivo/server/openclaw`
- `POST /api/tts`
  Uses `@charivo/server/openai` with default voice `marin` and model `gpt-4o-mini-tts`
- `POST /api/stt`
  Uses `@charivo/server/openai` with model `whisper-1`
- `POST /api/realtime`
  Uses `@charivo/server/openai` to create a realtime session bootstrap

## Runtime Modes

The settings UI intentionally exposes several implementation styles in one
place:

- remote API paths for production-oriented flows
- browser-direct OpenAI and OpenClaw paths for development and testing
- browser-native TTS and STT paths for zero-server speech experiments
- stub LLM mode for deterministic UI work

## Files To Read

- [`examples/web/README.md`](https://github.com/zeikar/charivo/blob/main/examples/web/README.md)
- [`examples/web/src/app/page.tsx`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/page.tsx)
- [`examples/web/src/app/hooks/useCharivoChat.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/hooks/useCharivoChat.ts)
- [`examples/web/src/app/hooks/useLive2D.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/hooks/useLive2D.ts)
- [`examples/web/src/app/hooks/useRealtimeMode.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/hooks/useRealtimeMode.ts)
- [`examples/web/src/app/hooks/realtime-ui.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/hooks/realtime-ui.ts)

## When To Use It

Use `examples/web` when you want:

- a concrete browser integration example
- working API route examples
- a reference for lifecycle boundaries between renderer setup and chat/session setup
- a place to compare runtime choices before designing your own app shell

## Related Guides

- [Getting Started](./getting-started.md)
- [Choosing Packages](./choosing-packages.md)
- [Architecture](./architecture.md)
