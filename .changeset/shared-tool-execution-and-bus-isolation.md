---
"@charivo/core": minor
"@charivo/realtime": patch
"@charivo/llm": patch
---

Share one tool-execution implementation across modalities and harden event dispatch.

- `@charivo/core` gains the execution helpers that `@charivo/llm` and
  `@charivo/realtime` previously duplicated: `createToolRegistry()` (returning
  the new `ToolRegistry` interface), `withToolTimeout`, `serializeToolResult`,
  and `createToolFailureOutput`. Like the existing validators, each takes an
  optional `toolLabel` so thrown messages still distinguish `LLM tool` from
  `Realtime tool`; existing message strings are unchanged.
- Realtime tool results are now serialized once inside the runner's failure
  boundary, and the parsed JSON snapshot is what reaches the transport, the
  `realtime:tool:result` event, and result projectors. A handler result that
  cannot be represented as JSON — notably one whose `toJSON()` returns
  `undefined`, which `JSON.stringify` reports without throwing — becomes a
  `{ success: false, error }` output and a `realtime:tool:error` event instead
  of reaching the transport with its `output` field silently dropped. Because
  the snapshot is taken before the transport serializes, a stateful `toJSON()`
  or getter can no longer return one value to the check and another to the
  wire. Handler results that were already plain JSON data are unaffected.
- `EventBus.emit(...)` isolates each listener. A listener that throws is
  reported via `console.error` and no longer prevents the listeners queued
  behind it from running, so a single bad subscriber can't skip downstream
  cleanup.
