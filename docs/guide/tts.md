---
title: TTS
sidebar_position: 7
---

# TTS

Charivo's TTS layer combines `@charivo/tts` with a concrete player.

For production browser apps, use the remote player with a server route backed
by `@charivo/server/openai`.

## Recommended Stack

```text
@charivo/tts
@charivo/tts/remote
your /api/tts route
@charivo/server/openai
```

## Basic Setup

```ts
import { createTTSManager } from "@charivo/tts";
import { createRemoteTTSPlayer } from "@charivo/tts/remote";

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

- `@charivo/tts/remote`
- production-oriented browser path
- sends text and voice options to your own API route

### Direct OpenAI

- `@charivo/tts/openai`
- useful for local development and testing
- exposes credentials to the browser

### Browser-Native

- `@charivo/tts/web`
- built on the Web Speech API
- useful for prototypes and zero-server flows
- voice behavior depends on browser and OS support

## What `@charivo/tts` Owns

- playback lifecycle
- lip-sync event emission
- player capability normalization through `playbackMode` and optional `audioMimeType`

`TTSManager` intentionally uses `setEventEmitter(...)`, not the full event bus.
It emits TTS lifecycle and lip-sync events back into core, but it does not
subscribe to upstream Charivo events.

## Provider Route

The remote player usually pairs with `@charivo/server/openai` on the
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

- Use `@charivo/tts/web` when you want no backend and browser variability is acceptable.
- Use `@charivo/tts/openai` when you are debugging OpenAI TTS behavior directly.
- Skip TTS when text chat is enough for the current experience.

## References

- [TTS Package README](https://github.com/zeikar/charivo/blob/main/packages/tts/README.md)
