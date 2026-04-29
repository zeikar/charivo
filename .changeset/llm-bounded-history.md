---
"@charivo/llm": minor
---

Bound LLM manager history to the latest 40 turns by default. Existing consumers
that rely on unbounded history can opt out with `maxHistoryTurns: null`.
