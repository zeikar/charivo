# TTS

This guide answers one question: how should you add speech playback to a
Charivo app?

Use it when you want the assistant to speak and need to choose between remote,
browser-direct OpenAI, and browser-native TTS.

## Recommended Default

For production browser apps, use:

```text
@charivo/tts-core
@charivo/tts-player-remote
your /api/tts route
@charivo/tts-provider-openai
```

That is the default path when you want server-mediated speech generation.

## Core Wiring

```ts
import { createTTSManager } from "@charivo/tts-core";
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";

const ttsManager = createTTSManager(
  createRemoteTTSPlayer({ apiEndpoint: "/api/tts" }),
);

await ttsManager.speak("Hello", { voice: "marin" });
```

Attach that manager to `Charivo`:

```ts
charivo.attachTTS(ttsManager);
```

## Player Choices

### Remote

- `@charivo/tts-player-remote`
- production-oriented browser path
- sends text and voice options to your own API route

### Direct OpenAI

- `@charivo/tts-player-openai`
- useful for local development and testing
- exposes credentials to the browser

### Browser-Native

- `@charivo/tts-player-web`
- built on the Web Speech API
- useful for prototypes and zero-server flows
- voice behavior depends on browser and OS support

## What `tts-core` Owns

- playback lifecycle
- lip-sync event emission
- player capability normalization through `playbackMode` and optional `audioMimeType`

`TTSManager` intentionally uses `setEventEmitter(...)`, not the full event bus.
It emits TTS lifecycle and lip-sync events back into core, but it does not
subscribe to upstream Charivo events.

## Provider Path

The remote path pairs the browser player with `@charivo/tts-provider-openai` on
the server:

```ts
const provider = createOpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultVoice: "marin",
  defaultModel: "gpt-4o-mini-tts",
});

const audio = await provider.generateSpeech(text, {
  voice: "marin",
  rate: 1,
});
```

## When To Use Another Path

- Use `tts-player-web` when you want no backend and browser variability is acceptable.
- Use `tts-player-openai` when you are debugging OpenAI TTS behavior directly.
- Skip TTS entirely when text chat is enough for the current experience.

## References

- [tts-core README](../../packages/tts-core/README.md)
- [tts-player-remote README](../../packages/tts-player-remote/README.md)
- [tts-player-web README](../../packages/tts-player-web/README.md)
- [tts-provider-openai README](../../packages/tts-provider-openai/README.md)

## Next Steps

- [Rendering](./rendering.md)
- [STT](./stt.md)
- [Realtime](./realtime.md)
