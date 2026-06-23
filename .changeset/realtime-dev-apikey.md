---
"@charivo/realtime": minor
---

`createOpenAIRealtimeAgentsClient` now accepts an optional `apiKey` (dev/testing only) that mints an ephemeral realtime client secret in-browser via `POST /v1/realtime/client_secrets`, mirroring `@charivo/llm/openai` and `@charivo/tts/openai`. Option precedence is `sessionBootstrap` > `apiEndpoint` > `apiKey`.
