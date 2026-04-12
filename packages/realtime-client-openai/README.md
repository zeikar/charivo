# @charivo/realtime-client-openai

OpenAI-specific realtime transport client for Charivo.

This package normalizes OpenAI Realtime WebRTC events into the transport event
contract used by `@charivo/realtime-core`. It can bootstrap sessions through an
API endpoint or a custom `sessionBootstrap(...)` callback.

## Install

```bash
pnpm add @charivo/realtime-client-openai
```

## Usage

```ts
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";

const client = createOpenAIRealtimeClient({
  apiEndpoint: "/api/realtime",
  debug: false,
});
```

## Server Contract

The client posts JSON shaped like:

```json
{
  "transport": "webrtc",
  "sdpOffer": "...",
  "session": {
    "provider": "openai",
    "model": "gpt-realtime-mini",
    "voice": "marin"
  }
}
```

The endpoint may respond with either:

- a `RealtimeSessionBootstrap` JSON object
- a plain SDP answer body for backward compatibility

## Notes

- Microphone access is required
- Audio playback is handled by WebRTC
- Lip-sync values are extracted from the incoming audio stream
- For production apps, prefer `@charivo/realtime-client-remote`
