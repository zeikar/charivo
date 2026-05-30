# Charivo Companion

A minimal companion demo that starts an OpenAI Realtime session and lets you
talk to a character via voice and text. It intentionally has no Live2D renderer
and no dedicated TTS/STT stack.

## What it does

- Connects to OpenAI Realtime over WebRTC through a `POST /api/realtime` route.
- Fetches a personalized memory block from `POST /api/memory` at cold-start and
  does one relevance refresh after the first user utterance.
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
via `buildRealtimeSessionConfig`), a demo-guidance block that keeps replies
short and natural for a live voice demo, and an optional memory block fetched
from `/api/memory`. Later subtasks can insert additional blocks at this seam
without touching the call site.

## Environment

Copy the example file and fill in your key:

```bash
cp examples/companion/.env.example examples/companion/.env.local
```

```env
OPENAI_API_KEY=your_openai_api_key_here

# Optional: absolute path for the SQLite memory database.
# Defaults to <cwd>/.data/companion-memory.db. ":memory:" is rejected.
COMPANION_MEMORY_DB=/path/to/companion-memory.db
```

## Run

> Requires Node >=22.5 (the memory store uses the built-in `node:sqlite`).

From the repository root:

```bash
pnpm install
pnpm build
pnpm --filter ./examples/companion dev
```

Then open `http://localhost:3001`.

## API Routes

- `POST /api/realtime`
  Uses `@charivo/server/openai` to create a Realtime session bootstrap for
  `@charivo/realtime/remote`. Validates that `transport` and `session` are
  present and that `session.provider` is `"openai"`, then returns the session
  bootstrap payload.

- `POST /api/memory`
  Accepts `{ scope: { userId, characterId }, query? }` and returns
  `{ instructionsBlock }` — a ready-to-inject memory string (empty string when
  no facts are stored). Runs the SQLite store server-side so `node:sqlite` never
  reaches the client bundle.

  > **Current limitation:** this subtask implements the read/injection path only.
  > The write path (`promoteSession`) is not yet wired into the live session, so
  > the store must be seeded externally for cross-session memory to appear.
  > Live write-wiring is deferred to a later subtask.

## Structure

```text
examples/companion/src/app
  api/
    realtime/route.ts
    memory/route.ts       ← memory injection endpoint
  hooks/
    useRealtimeSession.ts
  lib/
    compose-instructions.ts
  layout.tsx
  globals.css
  page.tsx
examples/companion/src/memory
  render-memory.ts        ← renderMemoryBlock, selectMemoryForRender
  build-memory-block.ts   ← buildMemoryInstructionBlock (render + select combined)
  sqlite-memory-store.ts  ← SQLite-backed MemoryStore
  db-path.ts              ← resolves COMPANION_MEMORY_DB with fallback
```
