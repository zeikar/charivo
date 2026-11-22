---
"@charivo/render-live2d": patch
---

`loadModel()` keeps the model of the latest call. Loads that overlapped used to finish in whatever order their files arrived, so switching models twice in quick succession could leave the first pick's model on screen, and the one it replaced was never released. A load that a later call overtook now releases its model and resolves without showing it; so does one that lands after `destroy()` or after a WebGL context restore rebuilt the host.
