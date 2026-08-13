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
coming out of the stream — on a short timer, and reports the end once that has
been silent for a beat. A ceiling bounds the wait for the case where the RMS
feed goes stale, such as a backgrounded tab throttling `requestAnimationFrame`.

Paths where audio genuinely stops rather than drains are unchanged and still
report immediately: barge-in, reconnect, errors, and session teardown.
