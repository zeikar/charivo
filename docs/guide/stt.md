# STT

This guide answers one question: how should you add microphone transcription to
a Charivo app?

Use it when you want turn-based speech input and need to choose between remote,
browser-direct OpenAI, and browser-native STT.

## Recommended Default

For production browser apps, use:

```text
@charivo/stt-core
@charivo/stt-transcriber-remote
your /api/stt route
@charivo/stt-provider-openai
```

That is the default path when the browser records locally and the actual
transcription happens through your backend.

## Core Wiring

```ts
import { createSTTManager } from "@charivo/stt-core";
import { createRemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

const sttManager = createSTTManager(
  createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" }),
);

await sttManager.start({ language: "ko" });
const text = await sttManager.stop();
```

Attach that manager to `Charivo`:

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
- STT lifecycle and error event emission back into core

`STTManager` intentionally uses `setEventEmitter(...)` rather than the full
event bus.

## Provider Path

The remote path pairs the browser transcriber with
`@charivo/stt-provider-openai` on the server:

```ts
const provider = createOpenAISTTProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: "whisper-1",
});

const text = await provider.transcribe(audioBlob, {
  language: "ko",
});
```

## When To Use Another Path

- Use `stt-transcriber-web` when you want the fewest moving parts and browser support is good enough.
- Use `stt-transcriber-openai` when you are testing direct vendor behavior.
- Move to [Realtime](./realtime.md) when you want continuous session-based voice interaction instead of turn-based start/stop transcription.

## References

- [stt-core README](../../packages/stt-core/README.md)
- [stt-transcriber-remote README](../../packages/stt-transcriber-remote/README.md)
- [stt-transcriber-web README](../../packages/stt-transcriber-web/README.md)
- [stt-provider-openai README](../../packages/stt-provider-openai/README.md)

## Next Steps

- [TTS](./tts.md)
- [Realtime](./realtime.md)
- [Examples Web](./examples-web.md)
