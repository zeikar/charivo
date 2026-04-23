---
"@charivo/core": minor
"@charivo/llm": minor
"@charivo/tts": minor
"@charivo/stt": minor
"@charivo/realtime": minor
---

Freeze the top-level Charivo API by adding symmetric `detachLLM()` /
`detachRenderer()` coverage plus `dispose()`, and normalize public failures to
typed `CharivoError` subclasses.

Breaking change: public throws now use typed errors from `@charivo/core`
instead of relying on generic `Error` strings. Consumers should switch from
`error.message.includes(...)` checks to `instanceof CharivoError` or
`error.code`.
