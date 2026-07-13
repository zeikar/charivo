---
"@charivo/llm": minor
"@charivo/tts": minor
"@charivo/stt": minor
"@charivo/server": minor
---

Deduplicate the provider implementations shared by the modality packages and `@charivo/server`.

**Additive — the modality subpaths now export their server-side providers.**
`@charivo/llm/openai`, `@charivo/llm/openclaw`, `@charivo/tts/openai`, and `@charivo/stt/openai` each now export their provider factory, provider class, and provider config type (`createOpenAILLMProvider` / `OpenAILLMProvider` / `OpenAILLMConfig`, and the OpenClaw, TTS, and STT equivalents) alongside the browser client, player, and transcriber factories they already exported. `@charivo/server/openai` and `@charivo/server/openclaw` now re-export those same names instead of duplicating the implementations — every existing `@charivo/server` import keeps working, with names, shapes, and concrete factory return types unchanged. The realtime provider is still implemented in `@charivo/server`. No new provider implementation or class capability is introduced; the same four provider classes are now sourced from one place instead of two.

`@charivo/llm/openclaw`'s `sessionKey` (pins a conversation to a gateway-side session) lives on the provider config only. It is deliberately absent from the client config: the client is driven by `LLMManager`, whose `clearHistory()` and character switch clear only local history and cannot rotate a pinned gateway session, so a reset conversation would silently continue on the gateway's old transcript.

**Breaking — `@charivo/server`'s LLM/TTS/STT providers now throw `CharivoError` subclasses instead of plain `Error`s.**

- SDK failures throw `CharivoProviderError` (`code: "CHARIVO_PROVIDER_ERROR"`). The SDK's message is preserved and the original error is kept on `cause`. The `"OpenAI LLM Error: …"` and `"OpenClaw LLM Error: …"` message prefixes are gone, and the TTS and STT providers now wrap SDK failures where they previously propagated them raw.
- Request timeouts throw `CharivoTimeoutError` (`code: "CHARIVO_TIMEOUT_ERROR"`). This applies to the OpenAI LLM, TTS, and STT providers, which have a 30s timeout; the OpenClaw provider has no timeout wrapper. The OpenAI LLM timeout message gains its provider prefix (`"request timed out after 30000ms"` → `"OpenAI LLM request timed out after 30000ms"`).
- Constructing a provider in a browser without `dangerouslyAllowBrowser` throws `CharivoStateError` (`code: "CHARIVO_STATE_ERROR"`); the message text is unchanged.

`CharivoError extends Error`, so `catch (e)` and `e.message` still work. Code that matches on the old message prefixes, or that checks `e.constructor === Error`, does not.
