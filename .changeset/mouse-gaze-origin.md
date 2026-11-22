---
"@charivo/render": minor
"@charivo/render-live2d": minor
---

Add `setGazeOrigin(origin?)`: the point of the model the cursor-follow gaze is measured from. Until now a pointer was read against the canvas's centre, which on a full-body model is the waist, so a pointer on the face counted as above it and the character looked up. `@charivo/render` declares it as an optional `MouseTrackable` method with the `GazeOrigin` type — fractions of the model's own canvas, `(0, 0)` its top-left corner and `(1, 1)` its bottom-right, the same for any renderer — and `@charivo/render-live2d` implements it. Unset, the gaze is measured from the centre as before; taps and `lookAt` are unaffected; a renderer that does not implement it keeps working.
