# Charivo Companion

A minimal companion demo that starts an OpenAI Realtime session and lets you
talk to a character via voice and text. It intentionally has no Live2D renderer,
no dedicated TTS/STT stack, and no persistent memory — those are later subtasks.

## What it does

- Connects to OpenAI Realtime over WebRTC through a single `POST /api/realtime`
  route.
- Composes per-session instructions through `composeInstructions([...])` before
  calling `startSession({ instructions })`.
- Renders connection state, the latest assistant transcript, and controls to
  connect, disconnect, interrupt, and type a message.

## `composeInstructions` seam

`src/app/lib/compose-instructions.ts` is the single place where ordered
instruction blocks are assembled before the session starts:

```ts
composeInstructions([
  buildRealtimeSessionConfig({ character }).instructions, // persona block
  COMPANION_DEMO_GUIDANCE, // demo-guidance block
]);
```

Today the function joins a persona block (derived from the character definition
via `buildRealtimeSessionConfig`) and a demo-guidance block that keeps replies
short and natural for a live voice demo. Later subtasks will insert additional
blocks (e.g. memory) at this seam without touching the call site.

## Environment

Copy the example file and fill in your key:

```bash
cp examples/companion/.env.example examples/companion/.env.local
```

```env
OPENAI_API_KEY=your_openai_api_key_here
```

## Run

From the repository root:

```bash
pnpm install
pnpm build
pnpm --filter ./examples/companion dev
```

Then open `http://localhost:3000`.

## API Routes

- `POST /api/realtime`
  Uses `@charivo/server/openai` to create a Realtime session bootstrap for
  `@charivo/realtime/remote`. Validates that `transport` and `session` are
  present and that `session.provider` is `"openai"`, then returns the session
  bootstrap payload.

## Structure

```text
examples/companion/src/app
  api/
    realtime/route.ts
  hooks/
    useRealtimeSession.ts
  lib/
    compose-instructions.ts
  layout.tsx
  globals.css
  page.tsx
```
