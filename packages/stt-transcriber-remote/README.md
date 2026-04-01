# @charivo/stt-transcriber-remote

Browser-side remote STT transcriber for Charivo.

This package records audio in the browser and sends it to your server route for
transcription. That is the default production path for browser apps.

## Install

```bash
pnpm add @charivo/stt-transcriber-remote
```

## Usage

```ts
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

const transcriber = createRemoteSTTTranscriber({
  apiEndpoint: "/api/stt",
});

await transcriber.startRecording({ language: "ko" });
const text = await transcriber.stopRecording();
```

## Request Contract

`RemoteSTTTranscriber` sends multipart form data:

- `audio`: recorded browser audio
- `language`: optional language hint

## Config

- `apiEndpoint?` default: `/api/stt`
