# @charivo/stt

Stateful STT manager and recording helper for Charivo.

## Install

```bash
pnpm add @charivo/stt
```

## Usage

```ts
import { createSTTManager } from "@charivo/stt";
import { createRemoteSTTTranscriber } from "@charivo/stt/remote";

const sttManager = createSTTManager(
  createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" }),
);

await sttManager.start({ language: "en" });
const text = await sttManager.stop();
```

## Exports

- `createSTTManager(transcriber)`
- `isWebSTTSupported()` (from `@charivo/stt/web`) — SSR-safe check for Web Speech recognition support
- `@charivo/stt/openai`: `createOpenAISTTTranscriber(config)` (browser
  transcriber, dev/testing only) and, for server-side use,
  `createOpenAISTTProvider(config)`, `OpenAISTTProvider`, `type OpenAISTTConfig`
- `@charivo/stt/openai-realtime`: `createOpenAIRealtimeSTTTranscriber({ bootstrap })`
  (live WebRTC streaming transcriber, `gpt-realtime-whisper`) — the app injects
  `bootstrap(request) => Promise<{ answerSdp }>`, owns the credentials, and
  mints the `type: "transcription"` session with `turn_detection: null`; no
  key-bearing helper is shipped

## Event Bridge

`STTManager` accepts an emit-only event bridge through `setEventEmitter(...)`.
It emits STT lifecycle and error events back into core, and does not subscribe
through the shared event bus.

When connected, the manager emits:

- `stt:start`
- `stt:partial` (streaming transcribers only, e.g. `@charivo/stt/openai-realtime`)
- `stt:stop`
- `stt:error`

For the streaming transcriber, a mid-session failure does not push an event on
its own — it surfaces the next time the app calls `stop()`, which rejects and
emits `stt:error` (never a successful `stt:stop`).
