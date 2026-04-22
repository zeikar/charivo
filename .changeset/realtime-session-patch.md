---
"@charivo/realtime": minor
---

Change `updateSession(...)` to patch active realtime sessions in place instead of reconnecting, remove synthetic refresh lifecycle boundaries, keep the current session alive on patch failure, and forward `temperature` / `maxTokens` in OpenAI session updates.

Tighten the raw OpenAI patch flow so unrelated server errors do not reject in-flight session updates, require `interrupt()` before patching during an active response, add a configurable session update ack timeout, and bump `@openai/agents-realtime` to `0.8.5`.
