# Realtime WebRTC Smoke Harness

This harness verifies the realtime packages in a real browser WebRTC session
without depending on `examples/web`.

Covered chain:

- `@charivo/realtime-client-remote`
- `@charivo/realtime-client-openai-agents`
- `@charivo/realtime-core`
- `@charivo/realtime-provider-openai`

Run it explicitly:

```bash
pnpm exec playwright install chromium
RUN_LIVE_REALTIME_TESTS=1 OPENAI_API_KEY=your-key pnpm test:webrtc-smoke
```

Default realtime-core prompt evaluation runs as a separate live suite on the
same harness:

```bash
pnpm exec playwright install chromium
RUN_LIVE_REALTIME_TESTS=1 OPENAI_API_KEY=your-key pnpm test:webrtc-prompt-eval
```

What it proves:

- the browser can establish a live realtime session through `/api/realtime`
- the remote client and OpenAI agents client work together over WebRTC
- the realtime manager receives a real tool call and emits a canonical avatar
  event

This harness intentionally provides its own minimal `/api/realtime`
implementation. It does not validate the `examples/web` route. That route is
covered separately by the live bootstrap suite in `tests/live-realtime/`.

The `test:webrtc-smoke` suite uses a narrow deterministic harness mode to
verify connection and avatar-event plumbing. The `test:webrtc-prompt-eval`
suite uses the default `@charivo/realtime-core` instruction path and the full
canonical avatar tool surface to evaluate prompt-driven tool selection.

`test:webrtc-prompt-eval` is an advisory evaluation, not a CI gate. Model
outputs are nondeterministic, so treat failures as a signal to inspect the
default instructions or the prompt, not as a blocking regression. Only
`test:webrtc-smoke` is included in `pnpm test:integration`.

Cost note: `test:webrtc-prompt-eval` drives 3–4 live model turns per run
(connect + per-tool prompts, plus a gaze fallback turn when needed), so each
run incurs meaningfully more OpenAI usage than `test:webrtc-smoke`, which
drives a single turn.

What it does not prove:

- microphone UX quality
- output audio quality
- Live2D rendering behavior
- `examples/web` app behavior
