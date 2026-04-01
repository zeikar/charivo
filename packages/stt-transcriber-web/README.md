# @charivo/stt-transcriber-web

Browser-native STT transcriber built on the Web Speech API.

## Install

```bash
pnpm add @charivo/stt-transcriber-web
```

## Usage

```ts
import { createWebSTTTranscriber } from "@charivo/stt-transcriber-web";

const transcriber = createWebSTTTranscriber();

await transcriber.startRecording({ language: "en-US" });
const text = await transcriber.stopRecording();
```

## Notes

- Runs entirely in the browser
- Requires Web Speech API support
- `isSupportedBrowser()` is available on the concrete class
- Good for prototypes and zero-server setups
