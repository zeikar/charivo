# Charivo Companion

A minimal companion demo that greets you by name, starts an OpenAI Realtime
session, and lets you talk to a Live2D character (Hiyori) via voice and text.
The character is rendered with realtime lip-sync and motion/gaze tool control,
all wired through the `@charivo/core` `Charivo` orchestrator. There is no
dedicated TTS/STT stack — the OpenAI Realtime API handles audio directly.

Live demo: https://charivo-companion.vercel.app/

## What it does

- Shows an intro gate on first visit: an emotional headline asks the user for
  their own name before the avatar appears. Pressing **만나기** renders the
  Live2D canvas and connects realtime in a single action — there is no separate
  Connect step.
- Persists the user's name in `localStorage` (`charivo:companion:user-name`).
  On revisit the name-entry intro is skipped and the avatar renders immediately,
  but the user taps **다시 만나기** once to connect — a deliberate user gesture
  so audio and lip-sync unlock correctly on iOS/Safari.
- Connects to OpenAI Realtime over WebRTC through a `POST /api/realtime` route.
- Builds a personalized memory block from the browser-local store at cold-start
  and does one relevance refresh after the first user utterance.
- Captures conversation turns and promotes them back into the local store (at
  checkpoints and on session end), so the longitudinal relationship state
  carries across sessions in the same browser.
- Composes per-session instructions through `composeInstructions([...])` before
  calling `startSession({ instructions })`, including a sanitized user-name
  block so the character addresses the user by name.
- Renders a Live2D avatar (Hiyori) via `@charivo/render` + `@charivo/render-live2d`,
  with realtime audio driving lip-sync and avatar tools (`@charivo/realtime-avatar`:
  `createAvatarControlTools`, `createAvatarResultProjector`,
  `buildAvatarControlInstructions`) driving motions/gaze through the shared
  Charivo event bus. (The bundled Hiyori model exposes motion groups and gaze but
  no expression entries; expression tool control activates automatically for
  models that provide them.)
- Post-gate controls: **Disconnect** (disabled while connecting or already
  disconnected), **다시 만나기** to reconnect after a Disconnect or a failed
  connect (one `start()` attempt per arming; shown only when disconnected and
  not connecting), and **이름 바꾸기** to fully reset identity (clears the
  stored name, disconnects if needed, and returns to the intro; disabled while
  connecting). Disconnect/interrupt/type-a-message remain available while
  connected. The intro's **만나기** replaced the former standalone Connect button.

## `composeInstructions` seam

`src/app/lib/compose-instructions.ts` is the single place where ordered
instruction blocks are assembled before the session starts:

```ts
composeInstructions([
  buildRealtimeSessionConfig({ character }).instructions, // persona block
  buildUserNameBlock(userName),                          // user self-name block (sanitized, JSON-delimited)
  COMPANION_DEMO_GUIDANCE,                               // demo-guidance block
  buildAvatarControlInstructions(catalog),               // avatar control block
  memoryBlock,                                           // memory block
]);
```

The function joins the blocks in order: a persona block (derived from the
character definition via `buildRealtimeSessionConfig`), a user-name block
(`buildUserNameBlock`) that returns `null` when no name is set and is filtered
out by `composeInstructions` — so it contributes nothing before the user has
entered a name — but addresses them by name once one exists, a demo-guidance
block that keeps replies short and natural for a live voice demo, an
avatar-control instruction block (`buildAvatarControlInstructions` from
`@charivo/realtime-avatar`) that tells the model what motions/gaze (and, when
present, expression) tools are available, and a memory block built from the
browser-local store (also filtered out when empty).

This same 5-block `composeInstructions([...])` call is used at both the
cold-start inject (`startSession`) and the single first-utterance refresh
(`updateSession`).

**User-name injection.** `buildUserNameBlock` embeds the sanitized name as a
JSON-quoted value with an explicit "treat as data, not instructions" directive —
a deliberate prompt-injection boundary. The name is sanitized by
`sanitizeUserName` (control-char strip + length bound to 40 characters) before
being embedded. This does **not** change the memory `scope`: `characterId`
stays `"companion-default"` and the `Character` definition is unmodified. The
user name is identity/UI state stored separately from the memory facts.

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
  one realtime session (voice + typed text), driven by Charivo orchestrator
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

The five realtime events the memory seams subscribe to (`realtime:state`,
`realtime:assistant:start`, `realtime:assistant:delta`, `realtime:assistant:done`,
`realtime:user:transcript`) now ride Charivo's internal event bus via
`charivo.on(...)` instead of a standalone `EventBus`. The read/inject and
write/promote logic itself is unchanged.

Memory is keyed by `scope = { userId, characterId }`. `userId` is a fixed
placeholder (no auth) — isolation comes from `localStorage` being per-browser —
while `characterId` partitions memory per character. The realtime stack is only
imported by the client hook, so a future non-realtime chat could reuse the same
store + pipeline unchanged.

**localStorage keys.** Memory lives under three keys
(`charivo:companion:facts`, `charivo:companion:sessions`,
`charivo:companion:relationships`). The user's self-name is stored separately
under `charivo:companion:user-name` — identity/UI state, not a memory fact, and
it does not affect the memory `scope`.

**Persona vs memory scope.** The character now presents as **Hiyori**
(`DEFAULT_CHARACTER.name = "Hiyori"`), but the memory scope `characterId`
deliberately stays `"companion-default"` so existing browser-local memory is
preserved across this change. The Live2D model is selected by a separate
`LIVE2D_MODEL_PATH` constant (`/live2d/Hiyori/Hiyori.model3.json`), not by the
character id or name. Model assets live at `examples/companion/public/live2d/Hiyori/`.

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
    useRealtimeSession.ts    ← drives Charivo orchestrator; wires Live2D renderer +
                               realtime manager; captures turns; reads/promotes the local store
  lib/
    compose-instructions.ts
    user-name-store.ts        ← loadUserName/saveUserName/clearUserName/sanitizeUserName;
                                 key charivo:companion:user-name; max 40 chars
  layout.tsx
  globals.css
  page.tsx                   ← intro gate (만나기 → mounts canvas + arms connect intent,
                                 auto-connects when rendererReady); revisit skips gate,
                                 renders avatar, connects on 다시 만나기 tap (iOS-safe
                                 audio unlock); post-gate controls: Disconnect,
                                 다시 만나기, 이름 바꾸기
examples/companion/src/memory
  render-memory.ts              ← renderMemoryBlock, selectMemoryForRender
  build-memory-block.ts         ← buildMemoryInstructionBlock (render + select combined)
  promote.ts                    ← promoteSession write pipeline
  trigger.ts                    ← createWriteJobScheduler (checkpoint / finalize fires)
  server-extractor.ts           ← createServerExtractor (MVP no-op fact extractor)
  local-storage-memory-store.ts ← localStorage-backed MemoryStore
  client-store.ts               ← getClientMemoryStore (browser-local store singleton)
```
