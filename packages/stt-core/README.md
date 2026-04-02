# @charivo/stt-core

Stateful STT manager and recording helper for Charivo.

## Install

```bash
pnpm add @charivo/stt-core
```

## Usage

```ts
import { createSTTManager } from "@charivo/stt-core";
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

const sttManager = createSTTManager(
  createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" }),
);

await sttManager.start({ language: "ko" });
const text = await sttManager.stop();
```

## Exports

- `STTManagerImpl`
- `createSTTManager(transcriber)`
- `MediaRecorderHelper`

## Event Bridge

`STTManager` accepts an emit-only event bridge through `setEventEmitter(...)`.
It emits STT lifecycle and error events back into core, and does not subscribe
through the shared event bus.

When connected, the manager emits:

- `stt:start`
- `stt:stop`
- `stt:error`
