# Charivo Companion

A minimal companion demo that starts an OpenAI Realtime session and lets you
talk to a character via voice and text. It intentionally has no Live2D renderer
and no dedicated TTS/STT stack.

Live demo: https://charivo-companion.vercel.app/

## What it does

- Connects to OpenAI Realtime over WebRTC through a `POST /api/realtime` route.
- Builds a personalized memory block from the browser-local store at cold-start
  and does one relevance refresh after the first user utterance.
- Captures conversation turns and promotes them back into the local store (at
  checkpoints and on session end), so the longitudinal relationship state
  carries across sessions in the same browser.
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
short and natural for a live voice demo, and an optional memory block built from
the browser-local store. Later subtasks can insert additional blocks at this
seam without touching the call site.

## Environment

Copy the example file and fill in your key:

```bash
cp examples/companion/.env.example examples/companion/.env.local
```

```env
OPENAI_API_KEY=your_openai_api_key_here
```

## Run

> 🗂️ **Per-browser memory.** All memory lives in the browser's `localStorage`,
> so each browser profile gets its own isolated relationship state and facts —
> there is no shared server database. That is exactly what makes the demo safe to
> deploy publicly (every visitor gets their own memory) and serverless-friendly.
> Trade-offs: memory does not sync across devices/browsers, and clearing site
> data resets it. A real multi-device product would add auth + a server datastore
> (out of scope for this demo).

From the repository root:

```bash
pnpm install
pnpm build
pnpm --filter ./examples/companion dev
```

Then open `http://localhost:3001`.

## Memory flow

The entire memory engine is pure TypeScript and runs **in the browser** — there
is no server datastore. The client decides *when* to read/write and runs the
extract → merge → persist pipeline against a `localStorage`-backed store.

```text
browser (useRealtimeSession.ts)
  one realtime session (voice + typed text)
        │
        ├─ read (inject)  → buildMemoryInstructionBlock(store, scope, …)
        │                     → composeInstructions → startSession({ instructions })
        │
        └─ write (promote) → promoteSession(store, transcript, …)
                                        │
                              getClientMemoryStore()
                                └ LocalStorageMemoryStore  (window.localStorage)
```

- **Read (inject).** On `start()`, `buildMemoryInstructionBlock({ store, scope })`
  builds a memory block that is composed into `startSession({ instructions })`.
  After the first user utterance, a single rebuild with a `queryEmbedding`
  refreshes it via `updateSession(...)` — never per turn.
- **Write (promote).** Every turn (voice transcript or typed text) is appended to
  a cumulative transcript. A write-job scheduler ([trigger.ts](./src/memory/trigger.ts))
  fires a checkpoint every 10 turns and a final write on session end, each a
  `promoteSession({ store, transcript, finalize })`. The transcript is cumulative
  and `promoteSession` is idempotent (deterministic fact ids + a finalize-once
  ledger), so resent payloads never double-count.

Memory is keyed by `scope = { userId, characterId }`. `userId` is a fixed
placeholder (no auth) — isolation comes from `localStorage` being per-browser —
while `characterId` partitions memory per character. The realtime stack is only
imported by the client hook, so a future non-realtime chat could reuse the same
store + pipeline unchanged.

## API Routes

The only server route is the realtime bootstrap — memory is fully client-side
(see [Memory flow](#memory-flow)).

- `POST /api/realtime`
  Uses `@charivo/server/openai` to create a Realtime session bootstrap for
  `@charivo/realtime/remote`. Validates that `transport` and `session` are
  present and that `session.provider` is `"openai"`, then returns the session
  bootstrap payload.

> **MVP scope:** the fact extractor is currently a no-op (`createServerExtractor`),
> so live sessions persist the session record and advance the relationship
> (session count / rapport / last-seen) but do not yet mine content facts. A real
> LLM extractor lands in a later subtask; until then, content facts can still be
> seeded externally.
>
> **Corrections take effect next session.** Correction candidates (e.g. "forget
> that" / "that's wrong") are detected during merge, which soft-invalidates or
> supersedes the target fact. Because the model never rewrites long-term memory
> live, a correction's effect lands at the **next session start** (cold-start
> retrieval), not mid-conversation. Live spoken correction detection is gated on
> the same future real extractor; the marker logic itself is real and
> unit-tested via the scripted extractor today.

## Structure

```text
examples/companion/src/app
  api/
    realtime/route.ts
  hooks/
    useRealtimeSession.ts    ← captures turns; reads/promotes the local store
  lib/
    compose-instructions.ts
  layout.tsx
  globals.css
  page.tsx
examples/companion/src/memory
  render-memory.ts              ← renderMemoryBlock, selectMemoryForRender
  build-memory-block.ts         ← buildMemoryInstructionBlock (render + select combined)
  promote.ts                    ← promoteSession write pipeline
  trigger.ts                    ← createWriteJobScheduler (checkpoint / finalize fires)
  server-extractor.ts           ← createServerExtractor (MVP no-op fact extractor)
  local-storage-memory-store.ts ← localStorage-backed MemoryStore
  client-store.ts               ← getClientMemoryStore (browser-local store singleton)
```
