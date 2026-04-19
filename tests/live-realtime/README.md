# Live Realtime Bootstrap Tests

These tests live at the repo root because they exercise bootstrap and
realtime-manager plumbing across packages, not one publishable package and not
the `examples/web` app in isolation.

Run them explicitly:

```bash
RUN_LIVE_REALTIME_TESTS=1 OPENAI_API_KEY=your-key pnpm test:live-bootstrap
```

What this suite validates:

- the live bootstrap contract against `@charivo/server/openai`
- the local realtime manager tool pipeline up to canonical avatar events

What it does not validate:

- a real browser WebRTC session
- actual OpenAI-generated tool calls
- visible Live2D movement on screen

For full browser WebRTC coverage, use the dedicated
`tests/webrtc-smoke/` Playwright harness.
