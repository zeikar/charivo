---
"@charivo/core": minor
"@charivo/render": minor
"@charivo/render-live2d": minor
---

Expressions set via `avatar:expression` are now cleared automatically about 8
seconds after they are applied, and the model returns to its base face while
idle motion, eye blink, and breath keep running. This is on by default when
using `@charivo/render` with `@charivo/render-live2d`; previously an expression
persisted until something else replaced it. The hold is a fixed internal
duration — there is no configuration option for it yet.

The `Renderer` interface in `@charivo/core` gains an optional
`stopExpression()` method for clearing the active expression. If you implement
a custom renderer, add `stopExpression()` to opt into automatic release;
omitting it simply disables the release for that renderer.
