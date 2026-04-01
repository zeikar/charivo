# @charivo/tts-player-web

Browser-native TTS player built on the Web Speech API.

## Install

```bash
pnpm add @charivo/tts-player-web
```

## Usage

```ts
import { createWebTTSPlayer } from "@charivo/tts-player-web";

const player = createWebTTSPlayer();
await player.speak("Hello from the browser", { rate: 1 });
```

## Notes

- Runs entirely in the browser
- Requires `window.speechSynthesis`
- Voice availability depends on the browser and OS
- Best for prototypes or zero-server setups
