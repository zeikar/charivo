---
"@charivo/llm": patch
---

Abort the in-flight OpenAI LLM request when its 30s timeout fires. The timeout
previously only raced the wrapper promise, so the SDK kept waiting and kept
retrying after the caller had already been rejected. It now passes an
`AbortController` signal to `chat.completions.create`, matching the Gemini
provider.
