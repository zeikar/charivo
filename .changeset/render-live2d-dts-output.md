---
"@charivo/render-live2d": patch
---

Fix packaging regression where the declaration build emitted `renderer.d.ts`
under `dist/render-live2d/src/` instead of the `dist/src/` path declared in
`package.json`, breaking `pack:check` and leaving published type entries
unresolved.
