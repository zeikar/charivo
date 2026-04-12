# Charivo Web Demo

This is the reference Next.js app for the Charivo workspace. It exercises the
current architecture as it is actually shipped:

- Live2D rendering through `@charivo/render-live2d` and `@charivo/render-core`
- LLM chat through remote, direct, OpenClaw proxy, and stub clients
- TTS through remote, browser-native, and direct OpenAI players
- STT through remote, browser-native, and direct OpenAI transcribers
- Realtime voice sessions through `@charivo/realtime-client-remote` and `/api/realtime`

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

From the repository root:

```bash
pnpm install
pnpm build
pnpm --filter ./examples/web dev
```

Then open `http://localhost:3000`.

## API Routes

The demo ships these routes:

- `POST /api/chat`
  Uses `@charivo/llm-provider-openai` with model `gpt-4.1-nano`
- `POST /api/chat-openclaw`
  Uses `@charivo/llm-provider-openclaw`
- `POST /api/tts`
  Uses `@charivo/tts-provider-openai` with default voice `marin` and model `gpt-4o-mini-tts`
- `POST /api/stt`
  Uses `@charivo/stt-provider-openai` with model `whisper-1`
  Accepts multipart form data with `audio` and optional `language`
- `POST /api/realtime`
  Uses `@charivo/realtime-provider-openai` to create a realtime session
  bootstrap for `@charivo/realtime-client-remote`

There is no `GET /api/tts` route in the current demo.

## Runtime Modes

The settings menu intentionally mixes several implementation styles so you can
compare the tradeoffs:

- Remote API options are the production-ready defaults.
- Browser-direct OpenAI and OpenClaw options expose credentials to the browser.
  They are for local development and testing only.
- Browser TTS/STT options use Web Speech APIs and depend on browser support.
- The stub LLM mode is useful for UI work and deterministic demos.

## Structure

```text
examples/web/src/app
  api/
    chat/route.ts
    chat-openclaw/route.ts
    realtime/route.ts
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

That split keeps renderer lifecycle separate from conversation/session lifecycle.
