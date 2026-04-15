---
title: TTS
sidebar_position: 7
---

# TTS

Charivo's TTS layer combines `@charivo/tts-core` with a concrete player.

For production browser apps, use the remote player with a server route backed
by `@charivo/tts-provider-openai`.

## Recommended Stack

```text
@charivo/tts-core
@charivo/tts-player-remote
your /api/tts route
@charivo/tts-provider-openai
```

## Basic Setup

```ts
import { createTTSManager } from "@charivo/tts-core";
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";

const ttsManager = createTTSManager(
  createRemoteTTSPlayer({ apiEndpoint: "/api/tts" }),
);

await ttsManager.speak("Hello", { voice: "marin" });
```

Attach the manager to `Charivo`:

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

## Provider Route

The remote player usually pairs with `@charivo/tts-provider-openai` on the
server:

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

## Alternatives

- Use `tts-player-web` when you want no backend and browser variability is acceptable.
- Use `tts-player-openai` when you are debugging OpenAI TTS behavior directly.
- Skip TTS when text chat is enough for the current experience.

## References

- [tts-core README](https://github.com/zeikar/charivo/blob/main/packages/tts-core/README.md)
- [tts-player-remote README](https://github.com/zeikar/charivo/blob/main/packages/tts-player-remote/README.md)
- [tts-player-web README](https://github.com/zeikar/charivo/blob/main/packages/tts-player-web/README.md)
- [tts-provider-openai README](https://github.com/zeikar/charivo/blob/main/packages/tts-provider-openai/README.md)
