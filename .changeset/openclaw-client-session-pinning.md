---
"@charivo/llm": minor
---

Fix OpenClaw agent targeting in the direct OpenClaw client.

- **Behavior change:** the `x-openclaw-agent-id` header is now sent only when `agentId` is configured. It previously defaulted to `"main"`, which 400s on gateways that have no `main` agent. Omitting `agentId` now delegates to the gateway's configured default agent.
- **Behavior change:** the default `model` is now `"openclaw/default"` (was `"openclaw"`). This value is an agent target, not a backend model name; `openclaw/default` is the documented stable alias.

Note that `sessionKey` (added in `@charivo/server/openclaw`) is intentionally not offered here: this provider is driven by `LLMManager`, whose `clearHistory()` and character switch clear only local history and cannot rotate a pinned gateway session, so a reset conversation would silently continue on the old transcript.
