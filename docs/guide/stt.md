---
title: STT
sidebar_position: 8
---

# STT

Charivo's STT layer combines `@charivo/stt` with a concrete transcriber.

For production browser apps, use the remote transcriber with a server route
backed by `@charivo/server/openai`.

## Recommended Stack

```text
@charivo/stt
@charivo/stt/remote
your /api/stt route
@charivo/server/openai
```

The browser records locally. The backend handles transcription.

## Basic Setup

```ts
import { Charivo } from "@charivo/core";
import { createSTTManager } from "@charivo/stt";
import { createRemoteSTTTranscriber } from "@charivo/stt/remote";

const charivo = new Charivo();

charivo.attachSTT(
  createSTTManager(createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" })),
);

await charivo.getSTTManager()?.start({ language: "ko" });
const text = await charivo.getSTTManager()?.stop();
```

## Transcriber Choices

### Remote

- `@charivo/stt/remote`
- records in the browser and sends audio to your route as multipart form data
- best default for production browser apps

### Direct OpenAI

- `@charivo/stt/openai`
- useful for local development and testing
- exposes credentials to the browser

### Browser-Native

- `@charivo/stt/web`
- built on the Web Speech API
- useful for prototypes and zero-server flows
- browser support varies

## What `@charivo/stt` Owns

- recording lifecycle
- interaction with the transcriber implementation
- STT lifecycle and error events back into core

`STTManager` intentionally uses `setEventEmitter(...)` rather than the full
event bus.

## Provider Route

The remote transcriber usually pairs with `@charivo/server/openai` on the
server:

```ts
const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: "whisper-1",
});

const text = await provider.transcribe(audioBlob, {
  language: "ko",
});
```

## Alternatives

- Use `@charivo/stt/web` when you want the fewest moving parts and browser support is good enough.
- Use `@charivo/stt/openai` when you are testing direct vendor behavior.
- Move to [Realtime](./realtime.md) when you want continuous session-based voice interaction instead of turn-based transcription.

## References

- [STT Package README](https://github.com/zeikar/charivo/blob/main/packages/stt/README.md)
