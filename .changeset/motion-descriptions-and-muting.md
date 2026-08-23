---
"@charivo/core": minor
"@charivo/avatar": minor
"@charivo/render-live2d": minor
"@charivo/render": minor
---

Give motions descriptions, and stop tool-triggered motions from playing their baked-in audio

Motions reached the model as a bare list of group names, so it chose between
`Idle` and `TapBody` knowing nothing about either. `AvatarControlCatalog` now
takes an optional `motionDescriptions`, keyed by group with a positional array
per motion — `playMotion` takes a group and an index, and the index is where a
wrong pick actually happens. The meanings ride along in the `playMotion` tool
schema and the avatar instructions, exactly as expression descriptions do.

Separately, Cubism sample motions can carry a prerecorded voice clip, and the
renderer played it into the speakers — a stranger's voice over the character's
own, and while it played its RMS drove the mouth whenever realtime lip sync was
off. `avatar:motion` and `playMotionByGroup` now take an optional `muteSound`,
which `@charivo/avatar`'s result projector sets on tool-call motions. A muted
start refuses the clip, silences one already playing, and invalidates a load
still in flight.

Nothing changes for existing code: absent descriptions leave the tool schema
and instructions byte-identical, and an unflagged motion stays audible, so a
human-triggered motion keeps its sound.
