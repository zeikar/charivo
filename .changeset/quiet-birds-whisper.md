---
"@charivo/realtime": patch
---

Stop emitting a spurious `assistant.response.completed` event for the intermediate sub-cycle that closes when a tool call is dispatched. Tool-using user turns now produce a single `assistant.response.started` / `assistant.response.completed` pair that carries the post-tool reply, instead of two pairs where the first carried stale text (on the OpenAI Agents adapter) or an empty string (on the OpenAI adapter). Consumers that counted completions per user turn are no longer off-by-one when tools run.
