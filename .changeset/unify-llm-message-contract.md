---
"@charivo/core": minor
"@charivo/llm": minor
"@charivo/server": minor
---

`LLMClient.call` and `LLMProvider.generateResponse` now take the same
`LLMMessage[]` as their tool-calling siblings, so for typed callers TypeScript
rejects unknown roles, `tool` turns without `toolCallId`, and `toolCalls` on
user turns on either path — runtime input still needs a boundary parser, as
`examples/web/src/app/api/chat-request.ts` shows. The built-in manager already
produced that shape, so nothing changes at runtime for `createLLMManager`
users; the shipped providers' `generateResponse` (also reachable via
`@charivo/server`'s re-exports) now forwards assistant `toolCalls` / `tool`
turns with their wire fields instead of dropping them.

An implementer written against the old `Array<{ role: string; content: string
}>` parameter still compiles because that parameter is broader, while a caller
passing a value of that type does not — validate into `LLMMessage[]` at the
boundary or type the roles as literals.
