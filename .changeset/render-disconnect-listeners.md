---
"@charivo/render": minor
---

RenderManager now exposes `disconnect()` and tears down its event-bus listeners on detach/replace/destroy, fixing leaked/duplicate renderer calls.
