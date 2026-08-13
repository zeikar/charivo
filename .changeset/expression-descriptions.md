---
"@charivo/core": minor
"@charivo/avatar": minor
---

`AvatarControlCatalog` gains an optional `expressionDescriptions?: Record<string, string>`
so a consumer can attach a human-readable meaning to each expression ID. Previously the
`setExpression` tool exposed expression IDs to the model as a bare `enum` with a generic
property description, so a model whose expression IDs are opaque — the Cubism sample
models ship IDs like `F01`..`F08` — had nothing to choose on.

When descriptions are supplied, `@charivo/avatar` appends the meanings to the
`setExpression` `expressionId` parameter description and to `buildAvatarControlInstructions`
output. Keys are intersected with `catalog.expressions` and emitted in that array's order,
so unknown or stale keys are ignored and producers can pass a config through unfiltered;
the intersection is enforced in one place rather than at each call site. The formatter
itself stays internal — no new exports.

Fully backward compatible: with the field absent, or present but with no key matching an
available expression, both the tool schema and the instruction text are byte-identical to
before, and a model that ships no expressions still omits everything expression-related.
