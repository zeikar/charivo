---
'@charivo/llm': minor
'@charivo/tts': minor
'@charivo/stt': minor
'@charivo/realtime': minor
'@charivo/render': minor
'@charivo/server': minor
'@charivo/render-live2d': patch
---

Consolidate the public package surface into coarse modality packages and a subpath-only server package.

This release removes the old fine-grained package names in favor of:

- `@charivo/llm`
- `@charivo/tts`
- `@charivo/stt`
- `@charivo/realtime`
- `@charivo/render`
- `@charivo/server`

It also moves adapter/provider entrypoints to subpaths, keeps `@charivo/render-live2d` separate, and documents that consumers need `moduleResolution: "bundler" | "node16" | "nodenext"` for package subpath exports.
