# Choosing Packages

This guide answers one question: which Charivo packages should you pick for
your app?

Use it before wiring an app, especially if you are deciding between production,
demo, and zero-server setups.

## Recommended Default

For most browser apps, choose:

- `@charivo/core`
- the relevant `*-core` manager packages
- remote browser runtime packages
- provider packages behind your API routes

Choose browser-direct or browser-native packages only when you explicitly want
their tradeoffs.

## Decision Table

| Need | Pick | Why |
| --- | --- | --- |
| Production browser app | Remote browser package + provider package | Keeps credentials on the server |
| Local development against vendor APIs | Browser-direct vendor package | Fast setup, but browser secrets are exposed |
| Zero-server browser speech | Browser-native web package | No backend needed, but browser support varies |
| Deterministic demo or UI work | Stub client where available | No model dependency |

## Runtime Modes

Charivo currently exposes three runtime styles.

### Remote

Use remote packages by default.

Examples:

- `@charivo/llm-client-remote`
- `@charivo/tts-player-remote`
- `@charivo/stt-transcriber-remote`
- `@charivo/realtime-client-remote`

Use this path when:

- the app runs in the browser
- you want production-safe credential handling
- you already own API routes or server functions

### Browser-Direct

Use direct browser vendor packages for development, demos, or trusted
environments.

Examples:

- `@charivo/llm-client-openai`
- `@charivo/llm-client-openclaw`
- `@charivo/tts-player-openai`
- `@charivo/stt-transcriber-openai`
- `@charivo/realtime-client-openai-agents`
- `@charivo/realtime-client-openai`

Use this path when:

- you need the shortest local setup
- you are testing provider behavior directly
- exposing credentials in the browser is acceptable

### Browser-Native

Use browser-native speech packages when you want no backend for TTS or STT.

Examples:

- `@charivo/tts-player-web`
- `@charivo/stt-transcriber-web`

Use this path when:

- you want a prototype or zero-server feature
- browser support differences are acceptable
- provider-level model control is not required

## Package Combos By Feature

### Text chat with server routes

```text
@charivo/core
@charivo/llm-core
@charivo/llm-client-remote
@charivo/llm-provider-openai or @charivo/llm-provider-openclaw
```

### Text-to-speech with lip-sync events

```text
@charivo/core
@charivo/tts-core
@charivo/tts-player-remote
@charivo/tts-provider-openai
```

### Speech-to-text from the microphone

```text
@charivo/core
@charivo/stt-core
@charivo/stt-transcriber-remote
@charivo/stt-provider-openai
```

### Realtime voice sessions

```text
@charivo/core
@charivo/realtime-core
@charivo/realtime-client-remote
@charivo/realtime-provider-openai
```

### Live2D rendering

```text
@charivo/render-core
@charivo/render-live2d
```

## Rules Of Thumb

- If the app is user-facing and browser-based, start with remote packages.
- If the app is a demo or a development harness, browser-direct packages are acceptable.
- If you need the fewest moving parts for speech, browser-native TTS/STT can be enough.
- If you need realtime today, the recommended path is `@charivo/realtime-client-remote`, which can resolve the OpenAI Agents WebRTC adapter by default.

## Next Steps

- [Getting Started](./getting-started.md)
- [LLM](./llm.md)
- [TTS](./tts.md)
- [STT](./stt.md)
- [Realtime](./realtime.md)
