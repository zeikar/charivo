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
- the browser audio→lip-sync loop — the TTS manager analyzes its playing audio
  with the shared core `LipSyncAnalyzer` and emits `tts:lipsync:update`,
  which `RenderManager` consumes to drive the renderer with RMS updates during
  playback — the path that node-level tests cannot reproduce
- the LLM avatar-tool loop — the LLM manager is wired with `@charivo/avatar`'s
  tools and result projector, so the reply to the canned "smile for me"
  utterance drives a real `setExpression` tool call and an `avatar:expression`
  event, not just plain text
- the per-expression description channel — a second test drives a text-only turn
  (`runTextTurn`, no STT) asking the character to be angry, against a catalog of
  OPAQUE IDs (`F01`..`F08`, the shape a real Cubism model ships). The meanings
  reach the model only via `expressionDescriptions`, so landing on the angry ID
  proves the channel works end-to-end against a live model. Deleting the
  `expressionDescriptions` block in `src/main.ts` makes that test fail — its
  discriminating power was verified that way, not assumed

The harness intentionally provides its own minimal `/api/stt`, `/api/chat`, and
`/api/tts` implementations (mirroring the `examples/web` route contracts). It
does not validate the `examples/web` routes themselves.

What it does not prove:

- microphone or output audio quality
- Live2D rendering behavior (the harness renderer only records RMS calls)
- `examples/web` app behavior

Cost note: each run makes five live OpenAI calls — three for the cascade test
(one transcription, one chat completion, one speech synthesis) and two more for
the description test (one chat completion, one speech synthesis; it skips STT).
