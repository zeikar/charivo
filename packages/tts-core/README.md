# @charivo/tts-core

Stateful TTS manager for Charivo.

This package coordinates a `TTSPlayer`, audio playback lifecycle, and lip-sync
events. It works with browser-native speech, remote TTS APIs, and direct OpenAI
players.

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
- `detectTTSPlayerType(player)`
- `supportsGenerateAudio(player)`
- `getMimeTypeForPlayer(playerType)`

## Event Bridge

When connected to the Charivo event bus, the manager emits:

- `tts:audio:start`
- `tts:lipsync:update`
- `tts:audio:end`
