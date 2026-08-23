---
"@charivo/core": minor
"@charivo/realtime": minor
"@charivo/tts": minor
"@charivo/stt": minor
---

Have the manager factories return the members they always provide

`createRealtimeManager`, `createTTSManager`, and `createSTTManager` returned the
core interfaces, where `setEventEmitter`, `prepareAudio`, and `dispose` are
optional — correctly so, since a third-party manager may omit them. But the
built-in managers always implement them, and the factory's return type said
otherwise, so every caller had to narrow a method that could not be missing.

They now return `BuiltInRealtimeManager`, `BuiltInTTSManager`, and
`BuiltInSTTManager`: the same interfaces with those members required. This is
the shape `createLLMManager` has used since it started returning
`LLMManagerWithTools`.

Nothing is removed or renamed, and the core interfaces are untouched, so an
implementation or a variable typed as `TTSManager` keeps working exactly as
before.
