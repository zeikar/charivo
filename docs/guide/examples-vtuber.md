---
title: Examples VTuber
sidebar_position: 13
---

# Examples VTuber

`examples/vtuber` is the third reference app. It is the answer to a question the
other two leave open: Charivo does not decide when the character speaks, so how
does an app that feeds it from several sources do that? See
[Architecture — What Charivo Does Not Do](./architecture.md#what-charivo-does-not-do).

It runs a scripted ten-minute livestream on its own. A Live2D character (Haru)
opens the show, moves through topics, answers a mock viewer chat, reacts to
scripted game events, fills quiet moments, and says goodbye. A Director panel
shows each decision as it is made.

It is local-only: it has no live demo, and its scripts bind to `127.0.0.1`.

## What It Demonstrates

- A Director that decides what the character says next from four inputs: viewer
  chat, external agent events, an idle timer, and a segment schedule
- A priority queue with pacing, cooldowns, and interrupts in front of a
  [conversation brain](./llm.md), which is latest-wins on its own: every line
  is one typed `brain.submit(...)` turn
- A portable Director module that reaches the character only through two small
  contracts (`CharacterPort` and `ShowEventSource`), so the same module could sit
  in front of a different adapter
- A talker and an avatar director kept apart: the LLM writes only the spoken line,
  and `@charivo/avatar`'s
  [text-driven director](./avatar.md#text-driven-director) picks the expression
  and motion from that line with a second LLM call, so a failed classification
  does not stop the line
- Typed inputs for the three kinds of cue (`user` for viewer chat, `direction`
  for stage directions, `event` for game events) instead of text tags, and a
  `review` hook on the brain that withholds a reply echoing a stage direction,
  with a record of how the earlier tag-based workaround held

## How The Pieces Connect

```text
Director (queue, pacing) -> CharacterPort -> brain.submit(typed input)
  -> cascade brain (LLM, `review`) -> body.perform() -> TTS and render
```

The Director never talks to Charivo. The cascade adapter passes each line's
typed input to the brain and maps the settled `BrainTurnResult` onto the port:
`completed` and `cancelled` carry over, `failed` and `silent` both fail the
line. The brain's `review` receives the reply together with the request's
stage directions, and a reply that repeats one verbatim throws, so the line
fails and nothing is spoken. See [LLM](./llm.md) for the brain and
[Architecture](./architecture.md) for the body.

## Package List

```text
@charivo/core
@charivo/llm (remote client) + @charivo/tts (Web Speech player)
@charivo/avatar
@charivo/render + @charivo/render-live2d
@charivo/server (one route)
```

Chat goes through Gemini on the server. Speech is the browser's Web Speech API,
with lip sync simulated from the text. Nothing in the app uses OpenAI.

## API Routes

The only server route is chat:

- `POST /api/chat`
  Uses `@charivo/server/gemini` with model `gemini-3.5-flash-lite`. The model is
  pinned by the route, and the request's message count, size, and tool schemas
  are capped. It has no authentication and no rate limiting. It serves two
  callers, the talker and the avatar classifier, and neither sends tools

Because the route is unauthenticated and the show makes requests without anyone
typing, the `dev` and `start` scripts both pass `--hostname 127.0.0.1`. Do not expose the app on a
network or deploy it as it is.

## Why Speech Is Web Speech

Gemini TTS was capped at 10 requests per day on the demo key (measured
2026-11-22), and a ten-minute show needs dozens of lines. See
[Pacing and quotas](https://github.com/zeikar/charivo/blob/main/examples/vtuber/README.md#pacing-and-quotas)
in the README.

## Files To Read

- [`examples/vtuber/README.md`](https://github.com/zeikar/charivo/blob/main/examples/vtuber/README.md)
  for the run steps, the quota notes, the architecture, and the findings
- [`examples/vtuber/src/director/`](https://github.com/zeikar/charivo/tree/main/examples/vtuber/src/director)
  for the portable Director, its policy, and its tests
- [`examples/vtuber/src/adapters/charivo-cascade-port.ts`](https://github.com/zeikar/charivo/blob/main/examples/vtuber/src/adapters/charivo-cascade-port.ts)
  for how a settled brain turn becomes the end of a line
- [`examples/vtuber/src/app/hooks/useVtuberShow.ts`](https://github.com/zeikar/charivo/blob/main/examples/vtuber/src/app/hooks/useVtuberShow.ts)
  for the wiring

Two sections of the README matter beyond this app:

- [Architecture](https://github.com/zeikar/charivo/blob/main/examples/vtuber/README.md#architecture)
  maps the Director, through the brain, onto a talker plus skill agents, and
  says what is not built
- [Findings: non-user input](https://github.com/zeikar/charivo/blob/main/examples/vtuber/README.md#findings-non-user-input)
  records what feeding a character stage directions cost before typed inputs,
  and which API now answers each of the three findings: typed inputs, the
  brain's `review`, and `performance:*` / `floor:changed`

## Run It

From the repository root, with `GEMINI_API_KEY` set in
`examples/vtuber/.env.local`:

```bash
pnpm install
pnpm build
pnpm --filter ./examples/vtuber dev
```

Then open `http://127.0.0.1:3002` and press Start. The show spends the key
unattended until its ending segment, at least ten minutes in.

## When To Use It

Use `examples/vtuber` when you want:

- a reference for putting a scheduler and priority queue in front of the character
- a worked example of an interrupt that stops idle talk for an urgent viewer
- an adapter pattern that keeps the scheduling logic independent of Charivo

Use [Examples Web](./examples-web.md) instead for the LLM/TTS/STT client styles,
or [Examples Companion](./examples-companion.md) for a realtime-only app.

## Related Guides

- [Architecture](./architecture.md)
- [LLM](./llm.md)
- [Avatar Control](./avatar.md)
- [Examples Web](./examples-web.md)
- [Examples Companion](./examples-companion.md)
