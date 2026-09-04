# Live TTS Provider Tests

Node-level contract checks for the server-side TTS providers, one provider at
a time, against the real vendor APIs. They live at the repo root because they
compare providers from `@charivo/tts` against each other, not one package in
isolation.

Run them explicitly:

```bash
RUN_LIVE_TTS_TESTS=1 OPENAI_API_KEY=your-key GEMINI_API_KEY=your-key pnpm test:live-tts
```

Each provider's block skips on its own when its key is missing, so either key
alone runs half the suite.

What this suite validates, per provider (`@charivo/tts/openai`,
`@charivo/tts/gemini`):

- a short line synthesizes to a non-empty `ArrayBuffer`
- the bytes are the container that provider's player labels its blob with.
  `TTSManager` plays through `new Audio(blobUrl)`, so a provider whose response
  format drifts from its label is a silent playback failure the SDK- and
  fetch-mocked unit tests cannot catch:
  - OpenAI answers with **MPEG audio** (asserted on the frame sync, measured
    `ff f3 ...` on 2026-09-04), not WAV — the provider's `format: "wav"` is
    inert because the SDK parameter is `response_format`
  - Gemini answers with headerless `audio/l16` PCM that the provider wraps in a
    44-byte RIFF header, so the buffer must open with `RIFF`/`WAVE`

What it does not validate:

- `@charivo/tts/remote` or the `examples/web` routes
- playback, lip-sync RMS, or anything downstream of the `ArrayBuffer`
- voice selection, or that the fixed synthesis preamble stays unspoken — that
  was confirmed by ear and is recorded in the demo docs

Cost note: 1 live call per provider per run, on a deliberately short line.

Gemini's block pins `timeoutMs: 25_000`, the same deadline `/api/tts-gemini`
ships. The provider retries once on a 5xx *inside* that budget, so when the
model is capacity-constrained the whole 25 s is spent and the failure surfaces
as `CharivoTimeoutError` rather than the underlying 503. That is vendor load,
not a regression — re-run later before investigating.
