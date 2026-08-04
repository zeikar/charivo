---
"@charivo/core": minor
"@charivo/tts": minor
"@charivo/render": minor
"@charivo/realtime": minor
---

Unify lip-sync audio analysis behind one shared analyzer in `@charivo/core`.

`createLipSyncAnalyzer` (speech-band RMS, `min(rms * 2, 1)`) is now the single
implementation used by every lip-sync producer: the TTS manager analyzes the
`<audio>` element it plays for `"audio"` playback mode, and both realtime
clients analyze their incoming `MediaStream`. All producers emit
`tts:lipsync:update`; `RenderManager` stays a pure consumer that toggles
`setRealtimeLipSync` and feeds `updateRealtimeLipSyncRms` from that event — it
no longer analyzes audio itself.

Breaking changes:

- `tts:audio:start` no longer carries `audioElement`; the payload is now
  `{ characterId? }`.
- `RenderManager.prepareAudio` is removed. Use `TTSManager.prepareAudio?.()`
  and/or `RealtimeManager.prepareAudio?.()` instead, from the same
  user-gesture handler that previously called
  `renderManager.prepareAudio?.()`. With `@charivo/realtime/remote`,
  `RealtimeManager.prepareAudio?.()` needs the same `RealtimeSessionConfig`
  you pass to `startSession()` to resolve which adapter to prepare — build
  one config and pass it to both:
  `await manager.prepareAudio?.(sessionConfig);` then
  `await manager.startSession(sessionConfig);`.
- `"audio"` playback mode now requires the `TTSPlayer` to implement
  `generateAudio()`. `createTTSManager(player)` throws an explicit error for
  an `"audio"`-mode player that lacks it, instead of silently playing without
  lip-sync. Players that only implement `speak()` (e.g. the Web Speech API)
  must use `"web-speech"` mode, whose lip-sync comes from a text-driven
  simulation.

Also adds `TTSManager.dispose?.()` to release lip-sync audio resources for
apps that tear a `TTSManager` down outside `Charivo.dispose()` (which already
calls it automatically).
