# STT

Charivo's STT layer combines `@charivo/stt-core` with a concrete transcriber.

For production browser apps, use the remote transcriber with a server route
backed by `@charivo/stt-provider-openai`.

## Recommended Stack

```text
@charivo/stt-core
@charivo/stt-transcriber-remote
your /api/stt route
@charivo/stt-provider-openai
```

The browser records locally. The backend handles transcription.

## Basic Setup

```ts
import { createSTTManager } from "@charivo/stt-core";
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

const sttManager = createSTTManager(
  createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" }),
);

await sttManager.start({ language: "ko" });
const text = await sttManager.stop();
```

Attach the manager to `Charivo`:

```ts
charivo.attachSTT(sttManager);
```

## Transcriber Choices

### Remote

- `@charivo/stt-transcriber-remote`
- records in the browser and sends audio to your route as multipart form data
- best default for production browser apps

### Direct OpenAI

- `@charivo/stt-transcriber-openai`
- useful for local development and testing
- exposes credentials to the browser

### Browser-Native

- `@charivo/stt-transcriber-web`
- built on the Web Speech API
- useful for prototypes and zero-server flows
- browser support varies

## What `stt-core` Owns

- recording lifecycle
- interaction with the transcriber implementation
- STT lifecycle and error events back into core

`STTManager` intentionally uses `setEventEmitter(...)` rather than the full
event bus.

## Provider Route

The remote transcriber usually pairs with `@charivo/stt-provider-openai` on the
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

- Use `stt-transcriber-web` when you want the fewest moving parts and browser support is good enough.
- Use `stt-transcriber-openai` when you are testing direct vendor behavior.
- Move to [Realtime](./realtime.md) when you want continuous session-based voice interaction instead of turn-based transcription.

## References

- [stt-core README](../../packages/stt-core/README.md)
- [stt-transcriber-remote README](../../packages/stt-transcriber-remote/README.md)
- [stt-transcriber-web README](../../packages/stt-transcriber-web/README.md)
- [stt-provider-openai README](../../packages/stt-provider-openai/README.md)
