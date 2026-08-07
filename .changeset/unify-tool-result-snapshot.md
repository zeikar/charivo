---
"@charivo/core": minor
"@charivo/llm": minor
"@charivo/realtime": patch
---

Give tool-result projectors the same value on every modality, and share one
snapshot implementation between the tool runners.

`ToolResultProjectorContext.output` now always carries the JSON snapshot of the
handler result — the same value `tool:result` publishes and the same value the
model's tool turn receives. `@charivo/realtime` projectors already received the
snapshot; `@charivo/llm` projectors previously received the live handler object,
so a `Date` survived as a `Date` there and as an ISO string on the realtime
path. That divergence is gone: `output` means "the tool result as JSON",
whichever modality executed the tool.

Breaking for LLM projectors that read a value JSON cannot represent — a `Date`
now arrives as its ISO string and an `undefined` property is absent. Such values
were never part of what the model saw, so a projector depending on them was
reading a side channel that only existed on one path. Projectors that read plain
JSON values are unaffected.

`@charivo/core` gains `snapshotToolResult(result, toolName, toolLabel?)`
returning `{ serialized, snapshot }`, plus its `ToolResultSnapshot` type. Both
tool runners now call it instead of each maintaining their own
serialize/parse/re-assert sequence, so the two paths cannot drift apart again.
`serializeToolResult` is unchanged and still exported.
