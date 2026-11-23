---
"@charivo/avatar": minor
---

Add a text-driven avatar director beside the tool-calling mode: `createAvatarDirector(...)` reads each spoken line, asks a classifier for a catalog-valid expression and motion, and emits `avatar:expression` and `avatar:motion` (with `muteSound: true`). `createLLMAvatarClassifier(client)` is a classifier that makes one stateless `LLMClient.call()` per line, and `connectAvatarDirectorToCascade(bus, director)` wires the director to a cascade (`userSay()`) turn. The existing tool-calling exports are unchanged.
