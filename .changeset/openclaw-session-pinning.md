---
"@charivo/server": minor
---

Pin OpenClaw conversations to a server-side gateway session.

- Add `sessionKey` to `OpenClawLLMConfig`. When set, it is sent as the chat completion `user` field, which the OpenClaw gateway resolves to a stable session key. Without it the gateway opens a fresh session per request: the caller's history is still sent, so the model sees prior turns, but the gateway persists nothing between requests and each turn strands a throwaway session. With a session pinned, past turns are no longer resent (the gateway already holds them); system prompts are still sent every turn so the persona survives a dropped session. Rotate `sessionKey` to reset a conversation — the gateway keeps the old transcript under the old key. Behavior is unchanged when `sessionKey` is omitted.
- **Behavior change:** the `x-openclaw-agent-id` header is now sent only when `agentId` is configured. It previously defaulted to `"main"`, which 400s on gateways that have no `main` agent. Omitting `agentId` now delegates to the gateway's configured default agent.
- **Behavior change:** the default `model` is now `"openclaw/default"` (was `"openclaw"`). This value is an agent target, not a backend model name; `openclaw/default` is the documented stable alias.
