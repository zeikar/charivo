# Examples Web

This guide answers one question: how should you read the shipped `examples/web`
app as an integration reference?

Use it when you want a working example of the current architecture as it is
actually wired in this repo.

## What It Is

`examples/web` is the reference Next.js app for the workspace.

It exercises the current package stack, including:

- Live2D rendering through `@charivo/render-live2d` and `@charivo/render-core`
- LLM chat through remote, direct, OpenClaw proxy, and stub clients
- TTS through remote, browser-native, and direct OpenAI players
- STT through remote, browser-native, and direct OpenAI transcribers
- realtime voice sessions through `@charivo/realtime-client-remote` and `/api/realtime`

## Read This App In Two Layers

The current lifecycle split is deliberate:

- `useLive2D` owns canvas mount and unmount
- `useCharivoChat` owns Charivo setup, manager attachment, event subscription, and teardown

That keeps renderer lifecycle separate from conversation and session lifecycle.

## API Routes

The current reference app ships these routes:

- `POST /api/chat`
  Uses `@charivo/llm-provider-openai` with model `gpt-4.1-nano`
- `POST /api/chat-openclaw`
  Uses `@charivo/llm-provider-openclaw`
- `POST /api/tts`
  Uses `@charivo/tts-provider-openai` with default voice `marin` and model `gpt-4o-mini-tts`
- `POST /api/stt`
  Uses `@charivo/stt-provider-openai` with model `whisper-1`
- `POST /api/realtime`
  Uses `@charivo/realtime-provider-openai` to create a realtime session bootstrap

## Runtime Modes

The settings UI intentionally mixes multiple implementation styles so you can
compare tradeoffs in one place:

- remote API paths for production-oriented flows
- browser-direct OpenAI and OpenClaw paths for development and testing
- browser-native TTS and STT paths for zero-server speech experiments
- stub LLM mode for deterministic UI work

## Useful Files

- [`examples/web/README.md`](../../examples/web/README.md)
- [`examples/web/src/app/page.tsx`](../../examples/web/src/app/page.tsx)
- [`examples/web/src/app/hooks/useCharivoChat.ts`](../../examples/web/src/app/hooks/useCharivoChat.ts)
- [`examples/web/src/app/hooks/useLive2D.ts`](../../examples/web/src/app/hooks/useLive2D.ts)
- [`examples/web/src/app/hooks/useRealtimeMode.ts`](../../examples/web/src/app/hooks/useRealtimeMode.ts)
- [`examples/web/src/app/hooks/realtime-ui.ts`](../../examples/web/src/app/hooks/realtime-ui.ts)

## When To Use This Reference

Use `examples/web` when you want:

- a concrete browser integration example
- working API route examples
- a reference for lifecycle boundaries between renderer setup and chat/session setup
- a place to compare runtime choices before designing your own app shell

## Next Steps

- [Getting Started](./getting-started.md)
- [Choosing Packages](./choosing-packages.md)
- [Architecture](./architecture.md)
