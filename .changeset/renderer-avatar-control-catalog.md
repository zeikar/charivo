---
"@charivo/core": minor
---

Add the optional `Renderer.getAvatarControlCatalog()`: the renderer hands the app the loaded model's whole `AvatarControlCatalog` — expression ids, motion group counts and, where the model carries them, their descriptions — so an app no longer assembles it from `getAvailableExpressions` / `getAvailableMotionGroups` plus hand-written descriptions. Existing renderers are unaffected; the method is optional.
