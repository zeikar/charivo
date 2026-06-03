# Charivo Companion

A minimal companion demo that greets you by name, starts an OpenAI Realtime
session, and lets you pick a companion and talk to that Live2D character in a
full-bleed immersive voice-first stage — optional captions, no typed-message input (the
realtime transport still supports typed messages internally, but the UI no
longer exposes a text box). The character is rendered with realtime lip-sync
and motion/gaze tool control,
all wired through the `@charivo/core` `Charivo` orchestrator. There is no
dedicated TTS/STT stack — the OpenAI Realtime API handles audio directly.

Live demo: https://charivo-companion.vercel.app/

## What it does

- Shows an immersive intro gate on first visit: an eyebrow line, an emotional
  headline, a sub-heading, a single name field, and a **Meet her** button, laid
  out to the right of the **real, dimmed Live2D avatar** (collapsing to the
  bottom over the centered avatar on small screens). Left/right arrows beside the
  avatar pick the companion before you meet her — each character shows its name
  and a one-line blurb — and the choice **locks** once you meet her (changed only
  via Settings → "Start over"). The canvas mounts on load,
  so she is already present — dormant and darkened — behind the prompt. Pressing
  **Meet her** wakes her (she brightens and slides center) and connects realtime
  in a single action — there is no separate Connect step.
- Persists the user's name in `localStorage` (`charivo:companion:user-name`).
  On revisit the intro gate is skipped and the avatar renders immediately,
  but the user taps **Wake her** once to connect — a deliberate user gesture
  so audio and lip-sync unlock correctly on iOS/Safari.
- Connects to OpenAI Realtime over WebRTC through a `POST /api/realtime` route.
- Builds a personalized memory block (facts; session summaries are deferred —
  no LLM summarizer in the MVP, so they are always null) plus a separate
  relationship block (tone/address-style/session-count) from the browser-local
  store at cold-start, and also composes an UNGATED situational date/time block
  (present even for a first meeting); does one relevance refresh after the first
  user utterance.
- Captures conversation turns and promotes them back into the local store (at
  checkpoints and on session end), so the longitudinal relationship state
  carries across sessions in the same browser.
- Composes per-session instructions through the `buildSessionInstructions({...})`
  seam before calling `startSession({ instructions })`, including a sanitized user-name
  block so the character addresses the user by name.
- Renders the selected Live2D avatar via `@charivo/render` + `@charivo/render-live2d`,
  with realtime audio driving lip-sync and avatar tools (`@charivo/realtime-avatar`:
  `createAvatarControlTools`, `createAvatarResultProjector`,
  `buildAvatarControlInstructions`) driving motions/gaze through the shared
  Charivo event bus. (Bundled models vary — Hiyori exposes motion groups and gaze
  but no expression entries, while the alternate model adds expressions;
  expression tool control activates automatically for models that provide them.)
- Post-gate UX: a full-bleed Main stage with the Live2D avatar centered
  directly on the time-of-day ambient gradient — no glass tile, just the
  character, grounded by halos/floor/rim glow. A minimal top bar shows a
  connection status dot, the selected companion's
  name, and a status label. A bottom-center voice orb is the
  primary interaction surface. Optional captions (off by default) are shown
  attributed to the companion. A right slide-in Settings panel has two tabs:
  - **You & her** — rename yourself (takes effect the next time she wakes, not
    mid-session), a "start over with a new name" full reset that clears stored
    identity and returns to the intro (disabled while connecting), a captions
    toggle, and a connection control (**Let her rest** / **Wake her**).
  - **Memory** — list, add, and delete stored facts in the browser-local
    memory store.

## `buildSessionInstructions` seam

`src/app/lib/build-session-instructions.ts` is the single place where the
ordered instruction blocks are assembled before the session starts. It delegates
the falsy-drop + newline join to the lower-level `composeInstructions` helper in
`compose-instructions.ts`:

```ts
buildSessionInstructions({
  persona: renderPersonaInstructions(character, relationshipState, { now: now.getTime() }), // core base + invariants + state hook
  userNameBlock: buildUserNameBlock(userName),          // user self-name block (sanitized, JSON-delimited)
  demoGuidance: COMPANION_DEMO_GUIDANCE,                 // demo-guidance block
  avatarBlock: buildAvatarControlInstructions(catalog), // avatar control block
  memoryBlock,                                          // memory block (facts; session summaries deferred — null in MVP)
  relationshipBlock: renderRelationshipBlock(relationshipState, { now: now.getTime() }), // relationship (tone/address/session-count; "" and dropped for a first meeting)
  situationalBlock: renderSituationalContext(now),      // situational date/time block (ungated — present even for a first meeting)
});
```

The seam composes the blocks in this fixed order — falsy blocks are dropped by
the underlying `composeInstructions` filter/join: a persona block built by
`renderPersonaInstructions` — the character's invariant identity (core base from
`buildRealtimeSessionConfig` plus the structured `voice`/`values` invariants from
the app-layer `persona` field, always present), plus a per-character state hook
selected from the same p4-02 relationship buckets (`classifyRelationship`) so
persona flavor varies with relationship state while the character-agnostic
relationship directives still inject **separately** via the `relationshipBlock`
(no double-injection — character consistency no longer rests on the one
`personality` paragraph). A user-name block
(`buildUserNameBlock`) that returns `null` when no name is set and is filtered
out by `composeInstructions` — so it contributes nothing before the user has
entered a name — but addresses them by name once one exists, a demo-guidance
block that keeps replies short and natural for a live voice demo, an
avatar-control instruction block (`buildAvatarControlInstructions` from
`@charivo/realtime-avatar`) that tells the model what motions/gaze (and, when
present, expression) tools are available, a memory block (facts; session
summaries are deferred — the MVP has no LLM summarizer yet, so they are always
null, but the render pipeline supports them for when one is added) built from
the browser-local store (also filtered out when empty),
and a relationship block rendered from the longitudinal `RelationshipState` via
`renderRelationshipBlock` (tone/address-style/session-count — empty and dropped
for a first meeting), and a situational block rendered via
`renderSituationalContext(now)` from the session's single `now` value that
injects the user's local weekday + date + clock time as a bare fact (no greeting
instruction — the model greets and hooks on the day itself), is UNGATED (always
present, even for a first-time visitor), and adds a calmer nudge late at night;
formatted from fixed name arrays for locale-independent determinism.

This same 7-block `buildSessionInstructions({...})` seam is used at both the
cold-start inject (`startSession`) and the single first-utterance refresh
(`updateSession`) — the block order lives in exactly one place and is unit-tested
in `build-session-instructions.test.ts`.

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
        ├─ read (inject)  → buildMemoryInstructionBlock(store, scope, …)  (facts; summaries deferred)
        │                   + renderRelationshipBlock(getRelationship(scope), { now: now.getTime() })  (relationship)
        │                   + renderSituationalContext(now)  (situational date/time, ungated)
        │                     → buildSessionInstructions → startSession({ instructions })
        │
        └─ write (promote) → promoteSession(store, transcript, …)
                                        │
                              getClientMemoryStore()
                                └ LocalStorageMemoryStore  (window.localStorage)
```

- **Read (inject).** On `start()`, three blocks are composed into
  `startSession({ instructions })`: a memory block from
  `buildMemoryInstructionBlock({ store, scope })` (facts; session summaries are
  deferred — always null in the MVP), a relationship block from
  `renderRelationshipBlock(getRelationship(scope), { now: now.getTime() })` (tone/address-style/
  session-count), and a situational block from `renderSituationalContext(now)`
  (local weekday + date + clock time; ungated, always present). After the first
  user utterance, a single rebuild with a `queryEmbedding` refreshes the memory
  block (and re-reads the relationship and situational, each sharing the same
  per-site `now`) via `updateSession(...)` — never per turn.
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

**Character selection.** The intro picker chooses one of the characters in
`src/app/lib/character-catalog.ts` (Hiyori, calm/gentle; plus a bright, playful
alternate). Each catalog entry carries its own `id`, `name`, a one-line
`description` (the picker blurb), a long `personality` (the persona prompt),
`voice`, `modelPath`, and an optional `persona` (structured invariants +
per-bucket state hooks; see `persona.ts`) — so persona, voice, and the rendered
Live2D model all follow the selected character (the model loads from
`character.modelPath`, not a fixed constant). The selection persists under `charivo:companion:character-id`
and is **locked** once you meet her; the Settings "Start over" reset clears it
and returns to the picker at the default character.

**Per-character memory scope.** Memory is partitioned by the selected
character's `id` (the `characterId` in the scope). The single `makeMemoryScope`
helper (`src/app/lib/memory-scope.ts`) is the one source of truth, used by BOTH
the realtime session AND the Settings memory list, so each character keeps its
own isolated browser-local memory. Model assets live under
`examples/companion/public/live2d/`.

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
    CharacterPresence.tsx    ← panel-less Live2D avatar with halos/floor/rim glow (align + dim props)
    IntroScreen.tsx          ← intro copy/form (eyebrow/headline/sub/name field/Meet her); the dim
                               avatar behind it is the shared CharacterPresence layer, not part of this
    SettingsPanel.tsx        ← right slide-in panel; "You & her" + "Memory" tabs
  lib/
    compose-instructions.ts
    hearth-theme.ts          ← ambient gradient + theme tokens for the Hearth UX
    memory-facts.ts          ← helpers for listing/adding/deleting facts in the local store
    user-name-store.ts       ← loadUserName/saveUserName/clearUserName/sanitizeUserName;
                                key charivo:companion:user-name; max 40 chars
  layout.tsx
  globals.css
  page.tsx                   ← single stage tree; canvas mounts on load so the avatar renders
                                 (dimmed) during the intro. Meet her → arms connect intent + brightens
                                 her (auto-connects when rendererReady); revisit skips the intro, user
                                 taps Wake her (iOS-safe audio unlock); post-gate adds TopBar, VoiceOrb,
                                 Captions, and slide-in SettingsPanel over the shared CharacterPresence
examples/companion/src/memory
  render-memory.ts              ← renderMemoryBlock, selectMemoryForRender
  build-memory-block.ts         ← buildMemoryInstructionBlock (render + select combined)
  promote.ts                    ← promoteSession write pipeline
  trigger.ts                    ← createWriteJobScheduler (checkpoint / finalize fires)
  server-extractor.ts           ← createServerExtractor (MVP no-op fact extractor)
  local-storage-memory-store.ts ← localStorage-backed MemoryStore
  client-store.ts               ← getClientMemoryStore (browser-local store singleton)
```

## Credits

The bundled Live2D models are the property of their respective creators and are
included only to demonstrate Charivo:

- **Hiyori** (Hiyori Momose) — Live2D sample model, © Live2D Inc.
- **Yuki** — _Basic Series Ver3_ by **papa屋 (papaya)**, distributed free on
  [Booth](https://booth.pm/ko/items/5107332). Copyright remains with the
  original creator; this demo does not claim authorship.
