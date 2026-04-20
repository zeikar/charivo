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

The voice suite runs through its own Playwright config so the fake-audio
flag only affects this run. Both voice specs share the same config and
fixture; `pnpm test:voice` runs them together:

```bash
pnpm exec playwright install chromium
RUN_LIVE_REALTIME_TESTS=1 RUN_LIVE_VOICE=1 OPENAI_API_KEY=your-key \
  pnpm test:voice
```

Both specs feed a canned WAV
([fixtures/voice-smoke-input.wav](./fixtures/voice-smoke-input.wav)) into
Chromium's fake microphone and let server VAD endpoint the utterance. They
differ in what they measure:

- `realtime-voice-e2e.spec.ts` — registers the full avatar tool surface
  (`setExpression`, `playMotion`, `lookAt`) and logs the end-to-end
  turnaround under `[voice e2e]`. The delta here includes tool-selection
  overhead and is the realistic-voice counterpart to
  `realtime-default-prompt.spec.ts`.
- `realtime-voice-baseline.spec.ts` — registers no tools and uses the
  default instructions so the delta trends with network + VAD + model
  rather than tool planning. Logs the raw delta plus a
  "raw − known fixed cost" approximation under `[voice baseline]`
  (subtracts the fixture's leading silence + speech + VAD threshold).
  The approximation still carries session→mic-playback drift, so treat
  it as a trend/variance signal, not an absolute post-VAD latency.

The WAV fixture (`fixtures/voice-smoke-input.wav`) is checked into the
repo so the suite runs without local setup. If you regenerate it with
a different voice or rate, follow the command in
[fixtures/README.md](./fixtures/README.md) and update the timing
constants at the top of `realtime-voice-baseline.spec.ts` to match.
Both specs skip cleanly if the fixture is missing (e.g. in a sparse
checkout).

What it does not prove:

- microphone UX quality
- output audio quality
- Live2D rendering behavior
- `examples/web` app behavior
