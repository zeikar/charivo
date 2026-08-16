---
"@charivo/core": minor
---

Add `Charivo.getTTSManager()` and `Charivo.getLLMManager()`.

`getRenderManager()`, `getSTTManager()`, and `getRealtimeManager()` already
existed, so reading back the TTS or LLM manager was the one gap — apps had to
keep their own reference to a manager Charivo was already holding. All five
modalities now have a getter, each returning `undefined` when nothing is
attached.
