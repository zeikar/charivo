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
alone runs half the suite. That is also how you keep a run off a paid account —
naming only `GEMINI_API_KEY` exercises Gemini and never calls OpenAI:

```bash
RUN_LIVE_TTS_TESTS=1 GEMINI_API_KEY=your-key pnpm test:live-tts
```

What this suite validates, per provider (`@charivo/tts/openai`,
`@charivo/tts/gemini`):

- a short line synthesizes to a non-empty `ArrayBuffer`
- the container the vendor actually returns, which the SDK- and fetch-mocked
  unit tests cannot observe:
  - Gemini answers with headerless `audio/l16` PCM that the provider wraps in a
    44-byte RIFF header, so the buffer must open with `RIFF`/`WAVE`
  - OpenAI answers with **MPEG audio**, asserted on the frame sync plus the
    Layer III bits so an AAC container cannot pass in its place

The OpenAI result is the reason `@charivo/tts` labels that player's audio
`audio/mpeg`: the provider sends `format: "wav"`, which is not the parameter the
API reads — that is `response_format` — so it rides along in the body, is
ignored, and the mp3 default stands. That was measured here on 2026-09-04 (head `ff f3 ...`)
and the labels were corrected to match, rather than the request being changed
to ask for real WAV. This assertion is what keeps the two in agreement: if it
ever fails, the container moved and every label has to move with it.

What it does not validate:

- `@charivo/tts/remote` or the `examples/web` routes
- playback, lip-sync RMS, or anything downstream of the `ArrayBuffer`
- voice selection, or that the fixed synthesis preamble stays unspoken — that
  was confirmed by ear and is recorded in the demo docs

Cost note: 1 live call per provider per run, on a deliberately short line.
Gemini's free tier allows 10 requests per minute on the TTS model (measured
2026-09-04 — not the 3 per minute that `gemini-3.5-transcribe` allows), so
this suite is cheap enough to follow a cascade run; repeated back-to-back
runs will still exhaust it and surface as a 429.

Gemini's block pins `timeoutMs: 25_000`, the same deadline `/api/tts-gemini`
ships. One `generateSpeech` call is up to two API requests: the provider retries
a 5xx once, sharing the original deadline. So a capacity-constrained model
surfaces either way — as the vendor's own 503 when the retry fails with budget
left, or as `CharivoTimeoutError` when an attempt runs the deadline out. Both
were seen on 2026-09-04. That is vendor load, not a regression — re-run later
before investigating.
