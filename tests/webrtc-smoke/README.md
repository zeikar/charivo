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

What it proves:

- the browser can establish a live realtime session through `/api/realtime`
- the remote client and OpenAI agents client work together over WebRTC
- the realtime manager receives a real tool call and emits a canonical avatar
  event

What it does not prove:

- microphone UX quality
- output audio quality
- Live2D rendering behavior
- `examples/web` app behavior
