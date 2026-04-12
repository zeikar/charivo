# @charivo/realtime-client-remote

Browser-side realtime client for server API routes.

This is the default production path for realtime sessions: the browser talks to
your own `/api/realtime` route, and the server route talks to a provider
package such as `@charivo/realtime-provider-openai`.

## Install

```bash
pnpm add @charivo/realtime-client-remote
```

## Usage

```ts
import { createRemoteRealtimeClient } from "@charivo/realtime-client-remote";

const client = createRemoteRealtimeClient({ apiEndpoint: "/api/realtime" });
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

The server should respond with a `RealtimeSessionBootstrap` JSON object. Phase 1
currently supports WebRTC bootstrap only.
