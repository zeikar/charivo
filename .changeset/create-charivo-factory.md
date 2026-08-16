---
"@charivo/core": minor
---

Add `createCharivo(options)`, and remove three unimplemented public types.

`createCharivo` builds a `Charivo` with its managers already attached, so the
quick-start path is one declarative call instead of `new Charivo()` followed by
several `attach*` calls and `setCharacter()`. It brings the top-level
orchestrator in line with the `create*` factories every other component already
uses — `Charivo` was the only public type you instantiated with `new`.

```ts
const charivo = createCharivo({
  renderer: renderManager,
  llm: createLLMManager(createOpenAILLMClient({ apiKey })),
  tts: createTTSManager(createOpenAITTSPlayer({ apiKey })),
  character,
});
```

Every option is optional, and each accepts `null` as well as `undefined`, so a
manager held as nullable state can be passed straight through. The character is
applied after the managers are attached, so it reaches all of them without
depending on call order.

The `Charivo` class is still exported and `attach*` is unchanged, so existing
code keeps working. Reach for the class when you need to construct first and
attach later.

**Breaking for anyone importing them:** the `Conversation`, `Plugin`, and
`CharivoConfig` types are removed. All three were declared but never
implemented or referenced anywhere in the codebase — `Plugin` described a
plugin architecture that does not exist, and `CharivoConfig` described a
provider-by-name configuration shape incompatible with the current layering.
`CharivoOptions` is the new configuration type and is not a replacement for
`CharivoConfig`'s shape.
