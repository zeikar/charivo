# Live STT Provider Tests

Node-level contract checks for the server-side STT providers, one provider at
a time, against the real vendor APIs. They live at the repo root because they
compare providers from `@charivo/stt` against each other, not one package in
isolation.

Run them explicitly:

```bash
RUN_LIVE_STT_TESTS=1 OPENAI_API_KEY=your-key GEMINI_API_KEY=your-key pnpm test:live-stt
```

Each provider's block skips on its own when its key is missing, so either key
alone runs half the suite. That is also how you keep a run off a paid account —
naming only `GEMINI_API_KEY` exercises Gemini and never calls OpenAI:

```bash
RUN_LIVE_STT_TESTS=1 GEMINI_API_KEY=your-key pnpm test:live-stt
```

The fixture-based cases also skip when
`tests/webrtc-smoke/fixtures/voice-smoke-input.wav` is missing from the
checkout — see [its README](../webrtc-smoke/fixtures/README.md) to regenerate
it.

What this suite validates, per provider (`@charivo/stt/openai`,
`@charivo/stt/gemini`):

- the fixture clip ("Please say hi and smile for me.") transcribes to text
  matching the spoken word
- Gemini: the same fixture call also passes a language hint, proving
  `audioTranscriptionConfig.languageCodes` is still the field name the API
  accepts
- Gemini: a synthesized silent clip resolves to exactly `""`, pinning the
  measured `content: {}` silence shape

What it does not validate:

- `@charivo/stt/remote` or the `examples/web` routes
- the demo's upload handling, `MediaRecorderHelper`, or webm recordings —
  `tests/cascade-smoke` with `CASCADE_STT=gemini` covers the browser-recorded
  path
- whisper-1's behavior on silence, which is not asserted here because it
  hallucinates text rather than returning an empty string

Cost note: 1 live call for OpenAI, 2 for Gemini. Gemini's free tier allows 3
requests per minute, and `tests/cascade-smoke`'s Gemini leg spends 1 of those,
so a cascade run immediately followed by this suite still fits the window —
don't loop this suite or run it twice within a minute.
