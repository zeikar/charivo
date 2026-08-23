---
"@charivo/core": patch
"@charivo/avatar": patch
"@charivo/llm": patch
"@charivo/realtime": patch
"@charivo/render": patch
"@charivo/render-live2d": patch
"@charivo/server": patch
---

Give the remaining packages npm keywords

Only `@charivo/tts` and `@charivo/stt` carried `keywords`, so the other seven
published packages were reachable on npm by name alone — including `core` and
`render-live2d`, the two anyone looking for this project would search for
first. Each now lists five, in the shape the existing two set: `charivo`, then
what that package actually does.

Manifest metadata only. No code, exports, or types change.
