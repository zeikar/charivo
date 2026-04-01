# @charivo/realtime-client-openai

Browser-side OpenAI Realtime WebRTC client for Charivo.

This package does not hold your API key. It expects a server endpoint that
creates the Realtime session and returns the SDP answer.

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
  "sdpOffer": "...",
  "sessionConfig": {
    "model": "gpt-realtime-mini",
    "voice": "marin"
  }
}
```

The endpoint should respond with the SDP answer body as plain text.

## Notes

- Microphone access is required
- Audio playback is handled by WebRTC
- Lip-sync values are extracted from the incoming audio stream
- Pair this package with `@charivo/realtime-core`
