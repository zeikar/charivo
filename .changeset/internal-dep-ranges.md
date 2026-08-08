---
"@charivo/llm": patch
"@charivo/tts": patch
"@charivo/stt": patch
"@charivo/realtime": patch
"@charivo/render": patch
"@charivo/render-live2d": patch
"@charivo/avatar": patch
"@charivo/server": patch
---

Internal `@charivo/*` dependencies now publish as caret ranges (`workspace:^`) instead of exact pins (`workspace:*`), so a fresh install can dedupe this package against another compatible release of its `@charivo/*` dependencies instead of always nesting its own copy. While the workspace is on `0.x`, a caret range only spans patch releases of the same minor, so the full benefit lands once the affected packages reach `1.0.0` — installs mixing different `0.x` minors still nest separate copies today.

Published tarballs also no longer include the `dist/metafile-*.json` build artifacts (esbuild bundle metadata used for internal build verification); they were never meant to ship to consumers.
