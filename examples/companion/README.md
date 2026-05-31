# Charivo Companion

A minimal companion demo that greets you by name, starts an OpenAI Realtime
session, and lets you talk to a Live2D character (Hiyori) in a full-bleed
immersive voice-first stage — optional captions, no typed-message input (the
realtime transport still supports typed messages internally, but the UI no
longer exposes a text box). The character is rendered with realtime lip-sync
and motion/gaze tool control,
all wired through the `@charivo/core` `Charivo` orchestrator. There is no
dedicated TTS/STT stack — the OpenAI Realtime API handles audio directly.

Live demo: https://charivo-companion.vercel.app/

## What it does

- Shows an immersive two-column intro gate on first visit (collapses to one
  column on small screens): an eyebrow line, an emotional headline, a
  sub-heading, a single name field, and a **Meet her** button. Pressing **Meet
  her** renders the Live2D canvas and connects realtime in a single action —
  there is no separate Connect step.
- Persists the user's name in `localStorage` (`charivo:companion:user-name`).
  On revisit the intro gate is skipped and the avatar renders immediately,
  but the user taps **Wake her** once to connect — a deliberate user gesture
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
- Post-gate UX: a full-bleed Main stage with the Live2D canvas centered in a
  glass "character tile" with halos/glow, set against a time-of-day ambient
  gradient. A minimal top bar shows a connection status dot, the companion
  name ("Hiyori"), and a status label. A bottom-center voice orb is the
  primary interaction surface. Optional captions (off by default) are shown
  attributed to the companion. A right slide-in Settings panel has two tabs:
  - **You & her** — rename yourself (takes effect the next time she wakes, not
    mid-session), a "start over with a new name" full reset that clears stored
    identity and returns to the intro (disabled while connecting), a captions
    toggle, and a connection control (**Let her rest** / **Wake her**).
  - **Memory** — list, add, and delete stored facts in the browser-local
    memory store.

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
  components/
    Icon.tsx                 ← shared SVG icon wrapper
    AmbientBackground.tsx    ← time-of-day gradient backdrop
    TopBar.tsx               ← connection dot + companion name + status label
    VoiceOrb.tsx             ← bottom-center voice interaction surface
    Captions.tsx             ← optional companion-attributed caption overlay
    CharacterPresence.tsx    ← glass character tile with halos/glow around the Live2D canvas
    IntroScreen.tsx          ← two-column intro gate (eyebrow/headline/sub/name field/Meet her)
    SettingsPanel.tsx        ← right slide-in panel; "You & her" + "Memory" tabs
  lib/
    compose-instructions.ts
    hearth-theme.ts          ← ambient gradient + theme tokens for the Hearth UX
    memory-facts.ts          ← helpers for listing/adding/deleting facts in the local store
    user-name-store.ts       ← loadUserName/saveUserName/clearUserName/sanitizeUserName;
                                key charivo:companion:user-name; max 40 chars
  layout.tsx
  globals.css
  page.tsx                   ← intro gate (Meet her → mounts canvas + arms connect intent,
                                 auto-connects when rendererReady); revisit skips gate,
                                 renders avatar, user taps Wake her (iOS-safe audio unlock);
                                 post-gate: full-bleed stage with TopBar, VoiceOrb, Captions,
                                 CharacterPresence, and slide-in SettingsPanel
examples/companion/src/memory
  render-memory.ts              ← renderMemoryBlock, selectMemoryForRender
  build-memory-block.ts         ← buildMemoryInstructionBlock (render + select combined)
  promote.ts                    ← promoteSession write pipeline
  trigger.ts                    ← createWriteJobScheduler (checkpoint / finalize fires)
  server-extractor.ts           ← createServerExtractor (MVP no-op fact extractor)
  local-storage-memory-store.ts ← localStorage-backed MemoryStore
  client-store.ts               ← getClientMemoryStore (browser-local store singleton)
```
