---
"@charivo/llm": minor
"@charivo/server": patch
---

The OpenAI LLM provider's default model `gpt-4.1-nano` has been retired by OpenAI (requests answer 404). The default is now `gpt-5.6-luna`, sent with `reasoning_effort: "none"` so function tools and a custom `temperature` keep working. The new `reasoningEffort` option sets `reasoning_effort` for other models; it is not sent unless set, except on the default model. Requests now send `max_completion_tokens` instead of `max_tokens`, which gpt-5 family models require. `@charivo/server/openai` re-exports the `OpenAIReasoningEffort` type.
