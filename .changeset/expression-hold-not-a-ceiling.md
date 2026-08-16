---
"@charivo/render": patch
---

Stop the expression hold window from cutting a face back mid-sentence.

The 8s hold was written as a ceiling that raced `tts:audio:end`, whichever came
first. That was survivable only because realtime `tts:audio:end` used to fire
early; now that it reports true playback completion, any reply longer than the
window hit the timer instead and reset the expression while the character was
still speaking.

The window is now what its purpose always was — a fallback for configs where no
audio events flow at all, such as text-only setups that never emit
`tts:audio:start`/`tts:audio:end` and would otherwise never drop the face back.
While speech is playing the timer stands down and `tts:audio:end` is the
authority, however long the utterance runs, including for an expression raised
mid-utterance.
