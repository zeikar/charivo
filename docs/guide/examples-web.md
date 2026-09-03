---
title: Examples Web
sidebar_position: 11
---

# Examples Web

`examples/web` is one of two reference Next.js apps in the Charivo workspace, and
the one to read when comparing client styles. Read it as a current integration
example, not just a demo. The other is
[Examples Companion](./examples-companion.md), a realtime-only app.

## What It Covers

The app exercises the current package stack:

- Live2D rendering through `@charivo/render-live2d` and `@charivo/render`
- LLM chat through remote, direct, Gemini (remote and direct), OpenClaw proxy
  (dev builds only), and stub clients
- TTS through remote, browser-native, direct OpenAI, and Gemini (remote and
  direct) players
- STT through remote, browser-native, direct OpenAI, and streaming
  (`@charivo/stt/openai-realtime`) transcribers
- realtime voice sessions through `@charivo/realtime/remote` and `/api/realtime`,
  over the OpenAI Agents WebRTC adapter or the Gemini Live WebSocket adapter,
  chosen in the settings menu (Gemini Live by default)
- avatar expression/motion/gaze tool calling through `@charivo/avatar`, wired
  into both LLM chat and realtime voice sessions

## Lifecycle Split

The current hook split is deliberate:

- `useLive2D` owns canvas mount and unmount
- `useCharivoChat` owns Charivo setup, render/LLM/TTS/STT manager attachment, event subscription, and teardown
- `useRealtimeMode` owns the realtime manager: it attaches and detaches it on the shared Charivo instance, and starts and stops the session

This keeps renderer lifecycle separate from conversation lifecycle, and both separate
from realtime session lifecycle.

## API Routes

The current reference app ships:

- `POST /api/chat`
  Uses `@charivo/server/openai` with model `gpt-4.1-nano`
- `POST /api/chat-openclaw`
  Uses `@charivo/server/openclaw`
- `POST /api/chat-gemini`
  Uses `@charivo/server/gemini` with model `gemini-3.5-flash-lite`
- `POST /api/tts`
  Uses `@charivo/server/openai` with model `gpt-4o-mini-tts`. The route resolves
  the voice itself and passes it explicitly, so the provider default is never
  consulted: a supplied voice must be on the allowlist or the request is
  rejected with 400, and the `sage` fallback applies only when none is sent
- `POST /api/tts-gemini`
  Uses `@charivo/server/gemini` with model `gemini-3.1-flash-tts-preview`. Same
  voice-resolution behavior as `/api/tts`, against a Gemini-specific allowlist
  with a `Kore` fallback; text is capped at 400 characters, sized to the
  route's 25s deadline, which is kept under the remote player's 30s timeout,
  and `speed` is accepted but ignored
- `POST /api/stt`
  Uses `@charivo/server/openai` with model `whisper-1`
- `POST /api/realtime-transcription`
  Exchanges the streaming transcriber's SDP offer with OpenAI so the browser
  never holds a key
- `POST /api/realtime`
  Uses `@charivo/server/openai` or `@charivo/server/gemini`, as
  `session.provider` selects, to create a realtime session bootstrap; either
  branch rebuilds the session config server side, and the Gemini branch also
  requires `transport: "websocket"`

## Demo Safeguards

The routes are unauthenticated by design — they are a demo, not a deployable
backend. What they do carry is cost bounding, worth copying even though the auth
is missing: cost-bearing session fields are pinned server side
(`examples/web/src/app/api/demo-limits.ts`), TTS text and realtime
instructions/tools are size-capped, voices come from a per-provider allowlist,
and a client-side timer caps a production realtime session at 90 seconds (15
minutes in development) because the browser talks to the provider directly once
bootstrapped and the server can no longer hang up. A separate timer with the
same limit arms on STT recording, where the streaming transcriber holds an
equally wall-clock-billed session for as long as it records.

## Runtime Modes

The settings UI intentionally exposes several implementation styles in one
place:

- remote API paths for production-oriented flows
- browser-direct OpenAI, Gemini, and OpenClaw paths for development and testing
  (the OpenClaw options are hidden in production builds — they need a gateway
  on `OPENCLAW_BASE_URL`, which defaults to localhost); TTS mirrors the LLM
  split with its own Gemini Remote and Gemini Direct (Dev) options
- browser-native TTS and STT paths for zero-server speech experiments
- a streaming STT path backed by `/api/realtime-transcription`
- a realtime provider selector, OpenAI Realtime or Gemini Live, that starts on
  Gemini Live and locks while a call is connecting or up
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
