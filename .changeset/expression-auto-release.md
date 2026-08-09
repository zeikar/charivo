---
"@charivo/core": minor
"@charivo/render": minor
"@charivo/render-live2d": minor
---

Expressions set via `avatar:expression` are now released automatically
about 8 seconds after they are applied: the model fades back to its base
face over the expression's `FadeOutTime` (1 second when the `.exp3.json`
does not specify one) while idle motion, eye blink, and breath keep
running. Parameters using the `Add` or `Multiply` blend fade smoothly when
their release duration is positive (an authored `FadeOutTime: 0` releases
instantly); parameters using `Overwrite` snap to their base value (the SDK
rebases overwrite values every frame). A release requested before the
expression has finished fading in waits for the fade-in to complete before
fading out, so an expression can remain visible beyond the nominal
8-second hold. This is on by default when using `@charivo/render` with
`@charivo/render-live2d`; previously an expression persisted until
something else replaced it. The hold is a fixed internal duration — there
is no configuration option for it yet.

The `Renderer` interface in `@charivo/core` gains an optional
`stopExpression()` method for releasing the active expression. If you
implement a custom renderer, add `stopExpression()` to opt into automatic
release; omitting it simply disables the release for that renderer.
