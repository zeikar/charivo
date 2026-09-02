---
"@charivo/llm": minor
"@charivo/server": minor
---

Add a `@charivo/llm/gemini` subpath with `createGeminiLLMProvider` and
`createGeminiLLMClient`, wrapping Gemini's OpenAI-compatible endpoint
(`https://generativelanguage.googleapis.com/v1beta/openai/`) with a default
model of `gemini-3.5-flash-lite`. `@charivo/server/gemini` re-exports
`createGeminiLLMProvider` alongside the existing realtime provider. Because
`LLMToolCall` carries no thought signature, the provider resends tool-call
history with Google's documented `skip_thought_signature_validator`
placeholder on the first tool call of each assistant turn, which loses
reasoning continuity across tool rounds.
