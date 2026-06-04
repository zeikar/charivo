---
"@charivo/core": minor
"@charivo/render": minor
---

Add `RenderManager.setLocalGaze(coords)` — a public local-presence gaze entry point (e.g. webcam face tracking) that drives the avatar's gaze as a peer of mouse-tracking. Returns `false` while AI gaze owns the avatar or when the renderer has no `lookAt`; it suspends mouse cursor tracking (not taps) through a separate window so a local-presence driver beats the cursor while still yielding to AI gaze.
