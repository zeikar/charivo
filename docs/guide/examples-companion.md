---
title: Examples Companion
sidebar_position: 11
---

# Examples Companion

`examples/companion` is the second shipped reference app. Where
[Examples Web](./examples-web.md) puts the client styles side by side for
comparison, the companion app is shaped like a product: a voice-first stage, a
companion you pick and then keep, and a relationship that persists across
sessions.

You choose a companion from a small catalog before meeting her, and the choice
locks until you start over. Memory is partitioned by the selected character, so
each companion keeps her own isolated memory namespace.

Live demo: [charivo-companion.vercel.app](https://charivo-companion.vercel.app/)

## What Makes It Different

It is a realtime-only stack. There is no LLM, TTS, or STT manager anywhere in
the app — the OpenAI Realtime API handles audio in and out directly, so the
package list is:

```text
@charivo/core
@charivo/realtime + @charivo/realtime-avatar
@charivo/render + @charivo/render-live2d
@charivo/server (one route)
```

One consequence worth noting: the character's speech drives lip-sync straight
from the realtime audio stream rather than through a TTS player.

## API Routes

The only server route is the realtime bootstrap:

- `POST /api/realtime`
  Uses `createOpenAIRealtimeProvider` from `@charivo/server/openai` to mint a
  session bootstrap for `@charivo/realtime/remote`. It validates that
  `transport` and `session` are present and that `session.provider` is
  `"openai"` before returning the payload.

Everything else runs in the browser.

## Browser-Local Memory

The memory engine is pure TypeScript running in the browser against a
`localStorage`-backed store — there is no server datastore. On session start the
app composes instruction blocks (persona, memory facts, relationship state,
situational date/time) and passes them to `startSession({ instructions })`.
During the session it captures turns and promotes them back into the store at
checkpoints and on session end, so the relationship carries into the next visit.

Because the store is per-browser, no visitor can read another's memory — which
is what makes the demo deployable without a database. That is a statement about
memory isolation, not about deployment safety: `/api/realtime` mints sessions
with your server's OpenAI key and has no authentication or rate limiting, so any
public deployment still needs its own abuse controls. It also means memory does
not sync across devices, and clearing site data resets it. A real product would
add auth and a server datastore.

One limitation worth knowing before you read the code: the MVP's fact extractor
is a no-op and session summaries are always null. Promotion still advances the
session record and the relationship state (session count, rapport, last seen),
but it does not yet mine content facts from the conversation — those are managed
by hand through the Settings panel until a real extractor lands.

The memory pipeline lives under `examples/companion/src/memory/` and is unit
tested there. Read [the app README](https://github.com/zeikar/charivo/blob/main/examples/companion/README.md)
for the full read/inject and write/promote flow — it is the source of truth for
the memory design, and this guide deliberately does not restate it.

## Avatar Control And Gaze

Motions and gaze are driven by the model through `@charivo/realtime-avatar`
(`createAvatarControlTools`, `createAvatarResultProjector`,
`buildAvatarControlInstructions`), bridged back into the render manager over the
shared Charivo event bus.

The app also ships optional webcam face tracking, off by default, that runs
on-device and feeds the avatar's gaze. It is a useful reference for the gaze
arbitration model described in [Rendering — Gaze Drivers](./rendering.md#gaze-drivers).

## Files To Read

- [`examples/companion/README.md`](https://github.com/zeikar/charivo/blob/main/examples/companion/README.md)
- [`examples/companion/src/app/hooks/useRealtimeSession.ts`](https://github.com/zeikar/charivo/blob/main/examples/companion/src/app/hooks/useRealtimeSession.ts)
- [`examples/companion/src/app/api/realtime/route.ts`](https://github.com/zeikar/charivo/blob/main/examples/companion/src/app/api/realtime/route.ts)
- [`examples/companion/src/memory/`](https://github.com/zeikar/charivo/tree/main/examples/companion/src/memory)

## Run It

From the repository root, with `OPENAI_API_KEY` set in
`examples/companion/.env.local`:

```bash
pnpm install
pnpm build
pnpm --filter ./examples/companion dev
```

Then open `http://localhost:3001`.

## When To Use It

Use `examples/companion` when you want:

- a realtime-only integration with no TTS/STT stack
- a reference for driving avatar motion and gaze from model tool calls
- a worked example of persisting character memory across sessions
- an app shell shaped like a product rather than a settings panel

Use [Examples Web](./examples-web.md) instead when you want to compare client
styles (remote vs browser-direct vs browser-native) or need LLM/TTS/STT wiring.

## Related Guides

- [Realtime](./realtime.md)
- [Rendering](./rendering.md)
- [Examples Web](./examples-web.md)
- [Architecture](./architecture.md)
