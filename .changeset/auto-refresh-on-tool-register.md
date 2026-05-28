---
"@charivo/realtime": patch
---

Auto-refresh active realtime session when tools are registered or unregistered

Previously, tools registered or unregistered after `startSession()` were silently invisible to the provider until the caller explicitly called `updateSession()`. The `registerTool` and `unregisterTool` methods now enqueue a session refresh automatically when a session is active. Idle managers (no active session) are unaffected and incur no cost.
