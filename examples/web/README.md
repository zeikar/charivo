# Charivo Web Demo

This is the reference Next.js app for the Charivo workspace. It exercises the
current architecture as it is actually shipped:

- Live2D rendering through `@charivo/render-live2d` and `@charivo/render`
- LLM chat through remote, direct, OpenClaw proxy, and stub clients
- TTS through remote, browser-native, and direct OpenAI players
- STT through remote, browser-native, direct OpenAI, and streaming OpenAI
  Realtime transcribers
- Realtime voice sessions through `@charivo/realtime/remote` and `/api/realtime`
  using the OpenAI Agents WebRTC adapter by default
- Avatar expression/motion/gaze tool calling from `@charivo/avatar`, wired into
  both LLM chat and realtime voice sessions

## Deploying this demo

> **These API routes have no authentication and no rate limiting. Do not deploy
> them as-is.**

Every route under `src/app/api/` is an unauthenticated proxy that anyone can
POST to. All of them except `/api/chat-openclaw` spend your paid
`OPENAI_API_KEY`; `/api/chat-openclaw` forwards to whatever `OPENCLAW_BASE_URL`
points at using `OPENCLAW_TOKEN`, so it exposes that credential and that backend
instead. That is fine for `pnpm dev:web` on your own machine, and it is what the
hosted demo accepts deliberately — it is not a production template, however much
it looks like one.

What the routes *do* defend against, in `src/app/api/demo-limits.ts`:

- **The model is pinned server-side.** `/api/realtime` rebuilds the session
  config instead of forwarding the caller's, so nobody can repoint the key at an
  expensive model or raise `maxTokens`. Same for the transcription model on
  `/api/realtime-transcription`.
- **Single requests are bounded.** Caps on chat message count, length, and
  serialized tool payloads; TTS input characters; STT upload size; realtime
  instruction and tool size.
- **Voices are restricted** to the ones the shipped characters use.
- **Realtime sessions and STT recordings stop after 90 seconds** in a production
  build; `pnpm dev:web` loosens that to 15 minutes so a debugging session is not
  cut off, and nothing but the build mode selects between them. Both are
  client-side timers: after bootstrap the browser talks to OpenAI directly, so
  the server cannot hang up. They bound an ordinary visitor, not a determined
  caller.

One thing the routes deliberately do **not** pin is `instructions`. The demo
composes them in the browser from the avatar catalog of whichever Live2D model
finished loading, so the server cannot rebuild them. They are size-capped, but a
caller can still supply their own system prompt on the pinned model — worth
knowing before you treat this as a template.

What they do **not** defend against — you have to add these yourself:

- No auth, no per-IP quota, no concurrency limit. One script can open many
  small sessions, and realtime bills on wall clock.
- The STT cap is a byte cap, not a duration cap. Low-bitrate audio packs more
  minutes into the same upload, and transcription bills per minute.
- Nothing caps total spend. Put a **hard per-project spend limit** on the
  OpenAI key you use, in its own project — enforcement is not instantaneous, so
  treat it as a backstop rather than a control.

## Environment

Copy the example file and fill in the values you actually plan to use:

```bash
cp examples/web/.env.example examples/web/.env.local
```

```env
OPENAI_API_KEY=your_openai_api_key_here

# Optional OpenClaw proxy settings
OPENCLAW_TOKEN=your_openclaw_token_here
OPENCLAW_BASE_URL=http://127.0.0.1:18789/v1
OPENCLAW_AGENT_ID=main
```

## Run

From the repository root, after setting up `.env.local` above:

```bash
pnpm install
pnpm dev:web
```

Then open `http://localhost:3000`.

`pnpm dev:web` builds the workspace packages first, then starts the demo dev
server. To run the steps yourself instead: `pnpm build` then
`pnpm --filter ./examples/web dev`.

## API Routes

The demo ships these routes:

- `POST /api/chat`
  Uses `@charivo/server/openai` with model `gpt-4.1-nano`
- `POST /api/chat-openclaw`
  Uses `@charivo/server/openclaw`
- `POST /api/tts`
  Uses `@charivo/server/openai` with model `gpt-4o-mini-tts`. The voice comes
  from the request (restricted to the shipped characters' voices); a character's
  own voice always wins, and `TTS_FALLBACK_VOICE` applies only when none is sent
- `POST /api/stt`
  Uses `@charivo/server/openai` with model `whisper-1`
  Accepts multipart form data with `audio` and optional `language`
- `POST /api/realtime`
  Uses `@charivo/server/openai` to create a realtime session
  bootstrap for `@charivo/realtime/remote`
- `POST /api/realtime-transcription`
  Mints an ephemeral transcription session secret and performs the SDP exchange
  for `@charivo/stt/openai-realtime`
  Accepts `{ sdpOffer, session: { model?, language? } }` and returns
  `{ answerSdp }`. `model` is accepted for wire compatibility but ignored — the
  route pins the transcription model itself

There is no `GET /api/tts` route in the current demo.

## Runtime Modes

The settings menu intentionally mixes several implementation styles so you can
compare the tradeoffs:

- Remote API options are the production-ready defaults.
- Browser-direct OpenAI and OpenClaw options expose credentials to the browser.
  They are for local development and testing only.
- Browser TTS/STT options use Web Speech APIs and depend on browser support.
- The streaming STT option keeps the key on the server and writes interim
  transcripts into the message box while you hold the mic.
- The stub LLM mode is useful for UI work and deterministic demos.

## Structure

```text
examples/web/src/app
  api/
    chat/route.ts
    chat-openclaw/route.ts
    realtime/route.ts
    realtime-transcription/route.ts
    stt/route.ts
    tts/route.ts
  components/
  hooks/
  stores/
  page.tsx
```

The current lifecycle boundary is deliberate:

- `useLive2D` owns canvas mount and unmount.
- `useCharivoChat` owns Charivo setup, manager attachment, event subscription, and teardown.

The demo also calls `realtimeManager.prepareAudio?.({ provider: "openai" })`
from the realtime connect click before it starts a WebRTC session — the remote
client needs that config to resolve which adapter to prepare. Keep that
user-gesture path intact on iOS or the first realtime lipsync pass may stay
silent.

That split keeps renderer lifecycle separate from conversation/session lifecycle.

## Credits

The bundled Live2D models are © Live2D Inc. and are included only to
demonstrate Charivo. All seven are official Live2D sample models distributed
under the
[Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html):

- **Haru**, **Hiyori**, **Mao**, **Mark**, **Natori**, **Rice**, **Wanko**

Using these models requires agreeing to the
[per-model terms](https://docs.live2d.com/cubism-editor-manual/sample-model/).

No model ships in any published `@charivo/*` package — they exist only in this
demo. The Cubism SDK itself carries separate terms; see
[`packages/render-live2d/LICENSE.md`](../../packages/render-live2d/LICENSE.md).
