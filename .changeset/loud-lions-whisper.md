---
"@charivo/realtime": patch
---

Tighten the default realtime agent instructions and the `lookAt` tool description so the model avoids bracketed stage directions (e.g. `[smile]`, `*laughs*`, `(gently)`) even when no avatar tools are available, and treats natural directional phrases as gaze triggers. Also clarifies the `x` / `y` parameter semantics on `lookAt` so coordinates match the intended direction.
