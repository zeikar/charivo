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

The transport now waits for playback to actually drain before reporting the
end. It samples the lip-sync analyzer — which measures the audio genuinely
coming out of the stream — on a short timer, and reports the end only once that
has been silent long enough to outlast the pauses inside natural speech. While
samples keep arriving and read audible the wait has no deadline, since ending on
a clock mid-playback is the very failure being fixed. A ceiling applies only
when the meter cannot be read at all — a halted frame loop, a suspended
`AudioContext`, or a stream that never attached — where a zero reading means
absence of data rather than observed silence.

`RealtimeManager`'s safety net that opens audio output from lip-sync alone now
uses the same audibility floor. Residual level after a segment properly ended
could previously re-open output that no further server completion would close,
leaving the audio lifecycle stuck active.

Paths where audio genuinely stops rather than drains are unchanged and still
report immediately: barge-in, reconnect, errors, and session teardown.
