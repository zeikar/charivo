# @charivo/realtime-provider-openai

Server-side OpenAI realtime provider for Charivo.

This package owns the OpenAI realtime session bootstrap call. In browser apps,
pair it with a server route and consume that route through
`@charivo/realtime-client-remote`.

## Install

```bash
pnpm add @charivo/realtime-provider-openai
```

## Usage

```ts
import { createOpenAIRealtimeProvider } from "@charivo/realtime-provider-openai";

const provider = createOpenAIRealtimeProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});

const session = await provider.createSession({
  transport: "webrtc",
  sdpOffer: "offer-sdp",
  session: {
    provider: "openai",
    model: "gpt-realtime-mini",
    voice: "marin",
  },
});
```

Returned bootstrap:

```json
{
  "adapter": "openai-webrtc",
  "transport": "webrtc",
  "answerSdp": "..."
}
```

## Config

- `apiKey`
- `baseUrl?` defaults to `https://api.openai.com/v1`
- `dangerouslyAllowBrowser?` testing only
