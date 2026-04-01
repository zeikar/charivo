---
"@charivo/core": minor
"@charivo/llm-client-openai": patch
"@charivo/llm-client-openclaw": patch
"@charivo/llm-client-remote": patch
"@charivo/llm-client-stub": patch
"@charivo/llm-core": patch
"@charivo/llm-provider-openai": patch
"@charivo/llm-provider-openclaw": patch
"@charivo/realtime-client-openai": patch
"@charivo/realtime-core": minor
"@charivo/render-core": minor
"@charivo/render-live2d": patch
"@charivo/render-stub": patch
"@charivo/shared": patch
"@charivo/stt-core": patch
"@charivo/stt-provider-openai": patch
"@charivo/stt-transcriber-openai": patch
"@charivo/stt-transcriber-remote": patch
"@charivo/stt-transcriber-web": patch
"@charivo/tts-core": patch
"@charivo/tts-player-openai": patch
"@charivo/tts-player-remote": patch
"@charivo/tts-player-web": patch
"@charivo/tts-provider-openai": patch
---

Tighten the public core contracts around the event bus, render manager integration,
and realtime session configuration. This release also republishes the affected
public packages with corrected exports, type entrypoints, and package metadata so
the published artifacts match the validated workspace builds.

Additional fixes include end-to-end STT `language` forwarding for the remote flow,
cleanup and lifecycle fixes in the web demo wiring, lower log noise in several
packages, and improved Live2D package compatibility for bundled app builds.
