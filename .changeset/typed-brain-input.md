---
"@charivo/core": minor
"@charivo/llm": minor
---

Typed brain input. `Message.type` gains `direction` (a private stage cue from the app) and `event` (data from outside the app, with a required `Message.source`); `Message.source` also names a user turn's speaker. `BrainInput`, `BrainRespond` and `BrainHistoryPolicy` describe an input with its reply and history policies, and `resolveBrainInput()` in `@charivo/llm` maps one to its `Message` with per-kind defaults.

The LLM converter now sends `system` history entries as `system` (they were sent as `assistant`), directions as `system` or, with `LLMManagerOptions.directionRole: "user"` (needed for Gemini), as prefixed `user` turns, and events as escaped, length-capped `user` data. A user turn that would open with either reserved marker is escaped. `addToHistory(message, { replaceKey })` replaces the entry stored under a key, `GenerateResponseOptions.ephemeral` shows a message for one request without storing it, and a reply that opens the history is no longer dropped from the prompt unless the history window cut it off. A pinned OpenClaw session no longer resends mid-history `system` messages every turn.
