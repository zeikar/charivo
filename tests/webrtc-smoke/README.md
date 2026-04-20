# Realtime WebRTC Smoke Harness

This harness verifies the realtime packages in a real browser WebRTC session
without depending on `examples/web`.

Covered chain:

- `@charivo/realtime/remote`
- `@charivo/realtime/openai-agents`
- `@charivo/realtime`
- `@charivo/server/openai`

Run it explicitly:

```bash
pnpm exec playwright install chromium
RUN_LIVE_REALTIME_TESTS=1 OPENAI_API_KEY=your-key \
  pnpm test:webrtc -- tests/webrtc-smoke/realtime-webrtc.spec.ts
```

Default realtime prompt evaluation runs as a separate live suite on the
same harness:

```bash
pnpm exec playwright install chromium
RUN_LIVE_REALTIME_TESTS=1 OPENAI_API_KEY=your-key \
  pnpm test:webrtc -- tests/webrtc-smoke/realtime-default-prompt.spec.ts
```

What it proves:

- the browser can establish a live realtime session through `/api/realtime`
- the remote client and OpenAI agents client work together over WebRTC
- the realtime manager receives a real tool call and emits a canonical avatar
  event

This harness intentionally provides its own minimal `/api/realtime`
implementation. It does not validate the `examples/web` route. That route is
covered separately by the live bootstrap suite in `tests/live-realtime/`.

The `realtime-webrtc.spec.ts` suite uses a narrow deterministic harness mode to
verify connection and avatar-event plumbing. The
`realtime-default-prompt.spec.ts` suite uses the default
`@charivo/realtime` instruction path and the full canonical avatar tool
surface to evaluate prompt-driven tool selection.

`realtime-default-prompt.spec.ts` is an advisory evaluation, not a CI gate.
Model outputs are nondeterministic, so treat failures as a signal to inspect
the default instructions or the prompt, not as a blocking regression.

Cost note: `realtime-default-prompt.spec.ts` drives 3–4 live model turns per
run (connect + per-tool prompts, plus a gaze fallback turn when needed), so
each run incurs meaningfully more OpenAI usage than `realtime-webrtc.spec.ts`,
which drives a single turn.

Voice latency baseline runs as a separate suite with its own Playwright
config so the fake-audio flag only affects this run:

```bash
pnpm exec playwright install chromium
RUN_LIVE_REALTIME_TESTS=1 RUN_LIVE_VOICE=1 OPENAI_API_KEY=your-key \
  pnpm test:voice
```

`realtime-voice.spec.ts` feeds a canned WAV
([fixtures/voice-smoke-input.wav](./fixtures/voice-smoke-input.wav)) into
Chromium's fake microphone, lets server VAD endpoint the utterance, and
records the delta from `realtime:session:start` to the first
`realtime:assistant:start`. The measurement is written to stdout as a
`[voice baseline]` line; bounds on it are sanity only. The WAV fixture is
not committed by default — see [fixtures/README.md](./fixtures/README.md)
for the regeneration command. The spec skips cleanly if the fixture is
missing.

What it does not prove:

- microphone UX quality
- output audio quality
- Live2D rendering behavior
- `examples/web` app behavior
