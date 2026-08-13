---
"@charivo/realtime": patch
---

Fix `tts:audio:end` firing while the character is still speaking in realtime
sessions.

The OpenAI Agents SDK's `audio_stopped` is raised on the server's
`response.output_audio.done`, which reports that the server finished SENDING
audio — not that the browser finished PLAYING it. Over WebRTC there is still
buffered audio at that point, so the WebRTC transport was reporting the end of
audio output several seconds early. Consumers that treat `tts:audio:end` as
"the speech this accompanied is over" acted on it mid-sentence: `RenderManager`
dropped a held expression there, so an avatar's face reset partway through its
own reply, and realtime lip-sync stopped with it.

The transport now reports the end from `output_audio_buffer.stopped`, the
WebRTC event that fires when the output buffer actually stopped playing — the
same signal `@charivo/realtime/openai` already treats as completion.

A fallback covers sessions where that event never arrives: it samples the
lip-sync analyzer, which measures the audio genuinely coming out, and calls
playback over once that has gone quiet for longer than the pauses inside natural
speech. While samples keep arriving and read audible the wait has no deadline,
since ending on a clock mid-playback is the failure being fixed; a ceiling
applies only when the meter cannot be read at all — a halted frame loop, a
suspended `AudioContext`, or a stream that never attached — where a zero reading
means absence of data rather than observed silence. Because silence alone cannot
prove a buffer is empty, any end the fallback decides stays recoverable: audible
output re-opens the segment and re-arms the drain, so it still receives a
matching end instead of leaving audio state open with nothing left to close it.

Paths where audio genuinely stops rather than drains are unchanged and still
report immediately: barge-in, reconnect, errors, and session teardown.
