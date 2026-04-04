# @charivo/tts-core

Stateful TTS manager for Charivo.

This package coordinates a `TTSPlayer`, audio playback lifecycle, and lip-sync
events. It works with browser-native speech, remote TTS APIs, and direct OpenAI
players.

Concrete players should declare `playbackMode` (`"audio"` or `"web-speech"`)
and can optionally declare `audioMimeType` so the manager does not need to rely
on constructor-name inference.

## Install

```bash
pnpm add @charivo/tts-core
```

## Usage

```ts
import { createTTSManager } from "@charivo/tts-core";
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";

const ttsManager = createTTSManager(
  createRemoteTTSPlayer({ apiEndpoint: "/api/tts" }),
);

await ttsManager.speak("Hello", { voice: "marin" });
```

## Exports

- `createTTSManager(player)`
- `WebSpeechLipSyncSimulator`
- `getTTSPlaybackMode(player)`
- `getTTSAudioMimeType(player)`
- `supportsGenerateAudio(player)`

## Event Bridge

`TTSManager` accepts an emit-only event bridge through `setEventEmitter(...)`.
It emits TTS lifecycle and lip-sync events back into core, but it does not
subscribe to upstream Charivo events.

When connected, the manager emits:

- `tts:audio:start`
- `tts:lipsync:update`
- `tts:audio:end`
