# Cascade (STT → LLM → TTS) Smoke Harness

This harness verifies the cascading (non-realtime) voice chain in a real browser
without depending on `examples/web`.

Covered chain (the recommended remote-client + server-provider path):

- `@charivo/stt/remote` → `/api/stt` → `@charivo/server/openai` (whisper-1)
- `@charivo/llm/remote` → `/api/chat` → `@charivo/server/openai` (gpt-4.1-nano)
- `@charivo/tts/remote` → `/api/tts` → `@charivo/server/openai` (gpt-4o-mini-tts)
- `@charivo/core` (`Charivo.userSay`) + `@charivo/render` (`RenderManager` lip-sync)

Run it explicitly:

```bash
pnpm exec playwright install chromium
RUN_LIVE_CASCADE=1 OPENAI_API_KEY=your-key pnpm test:cascade
```

It reuses the realtime voice fixture
([../webrtc-smoke/fixtures/voice-smoke-input.wav](../webrtc-smoke/fixtures/voice-smoke-input.wav))
as canned speech fed into Chromium's fake microphone, so the suite runs without
local setup. The spec skips cleanly if the fixture is missing or if
`RUN_LIVE_CASCADE` / `OPENAI_API_KEY` are not set.

What it proves:

- `RemoteSTTTranscriber` records the fake mic, posts it, and gets a transcript
- `Charivo.userSay` runs the transcript through the LLM and produces a reply
- the TTS manager synthesizes audio and plays it through its full lifecycle
  (`tts:audio:start` → `tts:audio:end`)
- the browser audio→lip-sync loop (`RenderManager` + `RealTimeLipSync`) drives
  the renderer with RMS updates during playback — the path that node-level
  tests cannot reproduce

The harness intentionally provides its own minimal `/api/stt`, `/api/chat`, and
`/api/tts` implementations (mirroring the `examples/web` route contracts). It
does not validate the `examples/web` routes themselves.

What it does not prove:

- microphone or output audio quality
- Live2D rendering behavior (the harness renderer only records RMS calls)
- `examples/web` app behavior

Cost note: each run makes three live OpenAI calls (one transcription, one chat
completion, one speech synthesis).
