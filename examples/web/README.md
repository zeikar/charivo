# Charivo Web Demo

This is the reference Next.js app for the Charivo workspace. It exercises the
current architecture as it is actually shipped:

- Live2D rendering through `@charivo/render-live2d` and `@charivo/render`
- LLM chat through remote, direct, OpenClaw proxy (dev builds only), and
  stub clients
- TTS through remote, browser-native, and direct OpenAI players
- STT through remote, browser-native, direct OpenAI, and streaming OpenAI
  Realtime transcribers
- Realtime voice sessions through `@charivo/realtime/remote` and `/api/realtime`,
  over either the OpenAI Agents WebRTC adapter or the Gemini Live WebSocket
  adapter, chosen in the settings menu
- Avatar expression/motion/gaze tool calling from `@charivo/avatar`, wired into
  both LLM chat and realtime voice sessions

## Deploying this demo

> **These API routes have no authentication and no rate limiting. Do not deploy
> them as-is.**

Every route under `src/app/api/` is an unauthenticated proxy that anyone can
POST to. Most of them spend your paid `OPENAI_API_KEY`. `/api/realtime` spends
your paid `GEMINI_API_KEY` instead whenever the caller asks for the Gemini
provider, which the demo's own UI does by default. `/api/chat-openclaw` spends neither: it forwards to whatever
`OPENCLAW_BASE_URL` points at using `OPENCLAW_TOKEN`, so it exposes that
credential and that backend. That is fine for `pnpm dev:web` on your own
machine, and it is what the hosted demo accepts deliberately — it is not a
production template, however much it looks like one.

What the routes *do* defend against, in `src/app/api/demo-limits.ts`:

- **The model is pinned server-side.** `/api/realtime` rebuilds the session
  config instead of forwarding the caller's and pins its own model for whichever
  provider it dispatched to, so nobody can repoint either key at an expensive
  model or raise `maxTokens`. Same for the transcription model on
  `/api/realtime-transcription`.
- **Single requests are bounded.** Caps on chat message count, length, and
  serialized tool payloads; TTS input characters; STT upload size; realtime
  instruction and tool size.
- **Voices are restricted** to the ones the shipped characters use, on the paths
  that take a voice at all — the Gemini realtime branch forwards none and lets
  that provider pick its own.
- **Realtime sessions and STT recordings stop after 90 seconds** in a production
  build; `pnpm dev:web` loosens that to 15 minutes so a debugging session is not
  cut off, and nothing but the build mode selects between them. Both are
  client-side timers: after bootstrap the browser talks to the provider
  directly, so the server cannot hang up. When either fires, a notice above the
  chat input (`SessionCapNotice`) says which cap stopped things, so it does not
  read as a bug. They bound an ordinary visitor, not a determined caller.

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
- Input transcription on the Gemini realtime path is always on and always
  billed: that provider rejects an `inputAudioTranscription` block naming a
  model, so its own default stands.
- Nothing caps total spend. Put a **hard per-project spend limit** on every key
  you use — the OpenAI one, and the Gemini one if you enable that provider —
  each in its own project; enforcement is not instantaneous, so treat it as a
  backstop rather than a control.

## Environment

Copy the example file and fill in the values you actually plan to use:

```bash
cp examples/web/.env.example examples/web/.env.local
```

```env
OPENAI_API_KEY=your_openai_api_key_here

# Needed for realtime voice, which defaults to Gemini Live
GEMINI_API_KEY=your_gemini_api_key_here

# Optional OpenClaw proxy settings
OPENCLAW_TOKEN=your_openclaw_token_here
OPENCLAW_BASE_URL=http://127.0.0.1:18789/v1
OPENCLAW_AGENT_ID=main
```

Realtime voice defaults to Gemini Live, which is the cheaper of the two APIs, so
`GEMINI_API_KEY` is what an out-of-the-box call spends. The settings menu lists
both providers whatever you configure, because the browser has no way to ask
which keys a deployment set. So a missing key surfaces only once a call is
attempted: it fails at connect time, the reason arrives above the chat input
(`RealtimeErrorNotice`), and switching to OpenAI Realtime in the menu is one
click away.

Both OpenClaw options are **dev-only**: they need a gateway on
`OPENCLAW_BASE_URL`, which defaults to localhost, so a deployed build has nothing
to reach and publishing that gateway would expose it. `ChatSettings` drops them
from the menu when `NODE_ENV` is `production`, leaving them available under
`pnpm dev:web`. The `/api/chat-openclaw` route still builds either way.

If you use the OpenClaw route and want avatar expression/motion/gaze tool calling
to work, the agent named by `OPENCLAW_AGENT_ID` must run on OpenClaw's own
embedded runtime. OpenClaw routes `openai/*` models to its Codex harness by
default, and that harness builds its tool list from OpenClaw's own tools only —
the demo's tools are accepted by the gateway and then dropped before the model
sees them, so the character just replies in text and never changes expression.
Override the runtime for that model in `~/.openclaw/openclaw.json`:

```json5
{
  agents: {
    list: [
      {
        // Must match OPENCLAW_AGENT_ID above.
        id: "main",
        models: { "openai/gpt-5.5": { agentRuntime: { id: "openclaw" } } },
      },
    ],
  },
}
```

Use whichever model id that agent actually runs as the `models` key. Runtime
selection is scoped to the provider/model, so this leaves your other agents
alone. Plain chat works either way; only tool calling is affected. Verified
against OpenClaw 2026.6.11.

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
  Creates a realtime session bootstrap for `@charivo/realtime/remote`, using
  `@charivo/server/openai` or `@charivo/server/gemini` as `session.provider`
  selects. Either branch rebuilds the session config server-side rather than
  forwarding the caller's; the Gemini branch additionally requires
  `transport: "websocket"`
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
- The realtime provider selector chooses OpenAI Realtime or Gemini Live for the
  next call, and starts on Gemini Live. It locks while a call is connecting or
  up — the manager is built
  once per session, so a mid-call switch could not take effect — and a Gemini
  call locks the character picker too, since that transport cannot patch a live
  session the way OpenAI can.
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

The demo also calls `realtimeManager.prepareAudio?.(...)` from the realtime
connect click, before `startSession(...)`. Both calls must be given the same
`provider`/`transport` pair, because that pair is what selects the adapter — so
the Gemini path needs `transport: "websocket"` in both. Keep that user-gesture
path intact on iOS or the first realtime lipsync pass may stay silent.

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
