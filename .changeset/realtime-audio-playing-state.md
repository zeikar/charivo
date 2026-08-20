---
"@charivo/core": minor
"@charivo/realtime": minor
---

Expose whether the character's audio is still playing on `RealtimeState`.

`response.status` answers "is the provider still generating", and consumers kept
reaching for it to answer "is the character still talking" — the only question
the state object appeared to offer. Those are different questions for the entire
tail of every turn: a response completes when the provider finishes SENDING
audio, and playback runs on past that. Anything built on the response status is
wrong for that whole window, and looks correct until someone barges in near the
end of a reply.

`RealtimeState.audioPlaying` reports the playback segment the manager already
tracks: true from `audio.output.started` until `audio.output.ended`, and cleared
when a session stops, fails, or reconnects. Those are the normalized transport
events every adapter emits, so it carries no provider-specific meaning. Changes
publish through `realtime:state` like the rest of the state.

Consumers that reconstructed this by subscribing to `tts:audio:start` /
`tts:audio:end` can drop that bookkeeping and read the field.
