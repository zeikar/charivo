---
"@charivo/realtime": patch
---

Deduplicate internal helpers in the OpenAI realtime client

Behavior-preserving refactor of `openai/client.ts`: the duplicated WebRTC bootstrap validation (initial connect + ICE-restart recovery) now shares a single `resolveWebRTCAnswerSdp` helper, the repeated assistant-response-started guard is extracted into `ensureAssistantResponseStarted`, and the two identical `*.done` final-text reconciliation blocks collapse into `emitFinalAssistantText`. The local `delay` duplicate is replaced with the shared `internal/timing` export. No public API or behavior change.
