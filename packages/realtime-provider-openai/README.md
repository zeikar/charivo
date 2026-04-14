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
  adapter: "openai-agents-webrtc",
  transport: "webrtc",
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
  "adapter": "openai-agents-webrtc",
  "transport": "webrtc",
  "clientSecret": "..."
}
```

Legacy direct OpenAI clients can still omit `adapter` and use the older
`openai-webrtc` + `answerSdp` bootstrap flow.

## Config

- `apiKey`
- `baseUrl?` defaults to `https://api.openai.com/v1`
- `dangerouslyAllowBrowser?` testing only
