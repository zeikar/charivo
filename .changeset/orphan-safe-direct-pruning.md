---
"@charivo/llm": patch
---

Stop history pruning from stranding character replies. `generateResponse(...)`
now trims to the exact bound and drops replies the eviction strands at the head,
the same discipline `addToHistory(...)` already used. Previously the direct path
pruned in turn-sized batches, so overlapping calls at a tight `maxHistoryTurns`
rounded up and evicted both pending user messages, leaving a transcript of
replies with nothing they answered.
