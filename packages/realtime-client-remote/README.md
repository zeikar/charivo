# @charivo/realtime-client-remote

Browser-side realtime client for server API routes.

This is the default production path for realtime sessions: the browser talks to
your own `/api/realtime` route, the route returns an adapter-aware bootstrap,
and the client resolves a browser transport adapter from its registry.

## Install

```bash
pnpm add @charivo/realtime-client-remote
```

## Usage

```ts
import {
  createRemoteRealtimeClient,
  DEFAULT_REMOTE_REALTIME_ADAPTERS,
} from "@charivo/realtime-client-remote";

const client = createRemoteRealtimeClient({ apiEndpoint: "/api/realtime" });
```

You can also extend the adapter registry:

```ts
const client = createRemoteRealtimeClient({
  apiEndpoint: "/api/realtime",
  adapters: {
    ...DEFAULT_REMOTE_REALTIME_ADAPTERS,
  },
});
```

## Request Contract

The current client posts JSON shaped like:

```json
{
  "transport": "webrtc",
  "session": {
    "provider": "openai",
    "model": "gpt-realtime-mini",
    "voice": "marin"
  },
  "sdpOffer": "..."
}
```

The server should respond with a `RealtimeSessionBootstrap` JSON object:

```json
{
  "adapter": "openai-webrtc",
  "transport": "webrtc",
  "answerSdp": "..."
}
```

Current defaults:

- the built-in resolver maps `provider: "openai"` + `transport: "webrtc"` to `openai-webrtc`
- the built-in registry only ships the OpenAI WebRTC adapter
