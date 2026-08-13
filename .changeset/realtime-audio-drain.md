---
"@charivo/realtime": patch
---

Fix `tts:audio:end` firing while the character is still speaking in realtime
sessions.

The OpenAI Agents WebRTC transport reported the end of audio output from the
SDK's `audio_stopped`, which is raised on the server's
`response.output_audio.done` — that reports the server finished SENDING audio,
not that the browser finished PLAYING it. There is still buffered audio at that
point, so the end arrived seconds early. Consumers that treat `tts:audio:end` as
"the speech this accompanied is over" acted on it mid-sentence: `RenderManager`
releases a held expression there, so an avatar's face reset partway through its
own reply, and realtime lip-sync stopped with it.

The end is now reported from `output_audio_buffer.stopped`, the WebRTC event for
the output buffer actually stopping — the same signal `@charivo/realtime/openai`
already treats as completion.

No timer or audio-level heuristic stands in for that event. A speculative end
reproduces the original defect, and an expression released mid-reply cannot be
un-released by a later correction; a session that never sees the event instead
holds the expression until `RenderManager`'s existing cap releases it. Paths
where audio genuinely stops rather than drains are unchanged and still report
immediately: barge-in, reconnect, errors, and session teardown.
