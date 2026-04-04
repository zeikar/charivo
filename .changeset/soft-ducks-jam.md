---
"@charivo/core": minor
"@charivo/tts-core": minor
"@charivo/tts-player-openai": patch
"@charivo/tts-player-remote": patch
"@charivo/tts-player-web": patch
---

Add explicit TTS player playback capabilities so `tts-core` can prefer
`playbackMode` and `audioMimeType` over implicit detection. This also removes
the old constructor-name and mime helper exports from `@charivo/tts-core`, so
player implementations should declare their playback behavior explicitly.
