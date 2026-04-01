# @charivo/tts-player-remote

Browser-side TTS player for server API routes.

This is the production-oriented browser TTS path for Charivo. The browser asks
your own server for audio, and the server holds the provider credentials.

## Install

```bash
pnpm add @charivo/tts-player-remote
```

## Usage

```ts
import { createRemoteTTSPlayer } from "@charivo/tts-player-remote";

const player = createRemoteTTSPlayer({
  apiEndpoint: "/api/tts",
  defaultVoice: "marin",
});
```

## Request Contract

`RemoteTTSPlayer` currently posts:

```json
{
  "text": "Hello",
  "voice": "marin",
  "speed": 1,
  "format": "wav"
}
```

The route is expected to return audio bytes.

## Config

- `apiEndpoint?` default: `/api/tts`
- `defaultVoice?` default: `marin`
