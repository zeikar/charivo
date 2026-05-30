# Charivo Companion

A minimal companion demo that starts an OpenAI Realtime session and lets you
talk to a character via voice and text. It intentionally has no Live2D renderer
and no dedicated TTS/STT stack.

## What it does

- Connects to OpenAI Realtime over WebRTC through a `POST /api/realtime` route.
- Fetches a personalized memory block from `POST /api/memory` at cold-start and
  does one relevance refresh after the first user utterance.
- Captures conversation turns and writes them back to memory through
  `POST /api/memory/promote` (at checkpoints and on session end), so the
  longitudinal relationship state carries across sessions.
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

- `POST /api/memory/promote`
  Accepts `{ scope, sessionId, startedAt, endedAt, turns, finalize }` and runs
  `promoteSession` against the same server-side store, returning the
  `{ result }` counts. `finalize: false` is a checkpoint; `finalize: true` (sent
  on session end) advances the relationship exactly once. Both routes share one
  store connection (`getCompanionStore`) so a write is immediately visible to
  the next read.

  > **MVP scope:** the server fact extractor is currently a no-op
  > (`createServerExtractor`), so live sessions persist the session record and
  > advance the relationship (session count / rapport / last-seen) but do not yet
  > mine content facts. A real LLM extractor lands behind a flag in a later
  > subtask; until then, content facts can still be seeded externally.

## Structure

```text
examples/companion/src/app
  api/
    realtime/route.ts
    memory/route.ts          ← memory injection (read) endpoint
    memory/promote/route.ts  ← memory promotion (write) endpoint
  hooks/
    useRealtimeSession.ts    ← captures turns + schedules promotion writes
  lib/
    compose-instructions.ts
  layout.tsx
  globals.css
  page.tsx
examples/companion/src/memory
  render-memory.ts        ← renderMemoryBlock, selectMemoryForRender
  build-memory-block.ts   ← buildMemoryInstructionBlock (render + select combined)
  promote.ts              ← promoteSession write pipeline
  trigger.ts              ← createWriteJobScheduler (checkpoint / finalize fires)
  server-extractor.ts     ← createServerExtractor (MVP no-op fact extractor)
  sqlite-memory-store.ts  ← SQLite-backed MemoryStore
  store-singleton.ts      ← shared file-backed store for the API routes
  db-path.ts              ← resolves COMPANION_MEMORY_DB with fallback
```
