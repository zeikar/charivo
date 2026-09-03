# Cascade (STT → LLM → TTS) Smoke Harness

This harness verifies the cascading (non-realtime) voice chain in a real browser
without depending on `examples/web`.

Covered chain (the recommended remote-client + server-provider path):

- `@charivo/stt/remote` → `/api/stt` → `@charivo/server/openai` (whisper-1)
- `@charivo/llm/remote` → `/api/chat` → `@charivo/server/openai` (gpt-4.1-nano),
  or `@charivo/server/gemini` (gemini-3.5-flash-lite) with `CASCADE_LLM=gemini`
- `@charivo/tts/remote` → `/api/tts` → `@charivo/server/openai` (gpt-4o-mini-tts),
  or `@charivo/server/gemini` (gemini-3.1-flash-tts-preview) with `CASCADE_TTS=gemini`
- `@charivo/core` (`Charivo.userSay`) + `@charivo/render` (`RenderManager` lip-sync)

Run it explicitly:

```bash
pnpm exec playwright install chromium
RUN_LIVE_CASCADE=1 OPENAI_API_KEY=your-key pnpm test:cascade

# Same specs, with the LLM leg on the Gemini provider (STT and TTS stay on OpenAI):
RUN_LIVE_CASCADE=1 CASCADE_LLM=gemini OPENAI_API_KEY=your-key GEMINI_API_KEY=your-key pnpm test:cascade

# Same specs, with the TTS leg on the Gemini provider (STT and LLM stay on OpenAI):
RUN_LIVE_CASCADE=1 CASCADE_TTS=gemini OPENAI_API_KEY=your-key GEMINI_API_KEY=your-key pnpm test:cascade

# Both legs on Gemini (STT stays on OpenAI):
RUN_LIVE_CASCADE=1 CASCADE_LLM=gemini CASCADE_TTS=gemini OPENAI_API_KEY=your-key GEMINI_API_KEY=your-key pnpm test:cascade
```

It reuses the realtime voice fixture
([../webrtc-smoke/fixtures/voice-smoke-input.wav](../webrtc-smoke/fixtures/voice-smoke-input.wav))
as canned speech fed into Chromium's fake microphone, so the suite runs without
local setup. The spec skips cleanly if the fixture is missing or if
`RUN_LIVE_CASCADE` / `OPENAI_API_KEY` are not set (or `GEMINI_API_KEY`, when
`CASCADE_LLM=gemini` and/or `CASCADE_TTS=gemini`).

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
  event, not just plain text. With `CASCADE_LLM=gemini` this round trip is
  also what exercises the Gemini provider's thought-signature placeholder on
  the resent tool call, the one leg unit tests cannot prove
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

Cost note: each run makes one transcription, two speech syntheses, and between
four and eight chat completions — every turn is a tool loop, so each of the two
tests spends two to four completions depending on how many tool rounds the
model takes. All of it goes to OpenAI by default; with `CASCADE_LLM=gemini`
the chat completions go to Gemini instead, and with `CASCADE_TTS=gemini` the
speech syntheses go to Gemini instead.
