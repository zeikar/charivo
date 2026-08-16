---
"@charivo/realtime": patch
---

Apply the playback-end fix to the raw `@charivo/realtime/openai` WebRTC
transport, which had the same defect as the OpenAI Agents transport.

It ended audio output on `response.audio.done` / `response.output_audio.done`,
which report that the SERVER finished sending audio rather than that the browser
finished playing it. Buffered audio is still playing at that point, so
`tts:audio:end` fired seconds early and consumers acted on it mid-sentence —
`RenderManager` releases a held expression there, resetting an avatar's face
partway through its own reply.

Only the output-buffer events now end audio output: `output_audio_buffer.stopped`
when playback finishes, and `output_audio_buffer.cleared` when an interruption
discards the buffer (previously unhandled). Lip-sync analysis is paused at the
end and resumed when the next segment starts, so a decaying residual level
cannot re-open output that no further buffer event would close.

Both WebRTC transports also stop resuming lip-sync analysis from page
visibility and pageshow handlers unless a playback segment is actually open.
Resuming after playback ended would meter residual level, which
`RealtimeManager` reads as a new audio start that no later buffer event would
close.
