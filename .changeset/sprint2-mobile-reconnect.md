"@charivo/core": minor
"@charivo/realtime": minor
"@charivo/render": minor
"@charivo/render-live2d": patch
"@charivo/stt": patch

Improve mobile realtime resilience by adding reconnect orchestration, reconnect
observability events, direct microphone ownership with safer browser
constraints, and iOS-friendly audio preparation hooks.

`@charivo/render-live2d` now handles WebGL context loss by rebuilding the host
and reloading the last model after restore. `@charivo/stt` now requests
browser-safe microphone constraints by default.
