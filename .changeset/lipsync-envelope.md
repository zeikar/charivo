---
"@charivo/core": minor
"@charivo/render-iki": patch
"@charivo/render-live2d": patch
---

Lip sync no longer holds the mouth wide open for the whole utterance.

- `@charivo/core`: `tts:lipsync:update`'s `rms` now means the final 0..1 mouth opening, which renderers apply as-is with no gain of their own. A custom renderer that amplified it, as the built-in ones did, should stop. The shared lip-sync analyzer now:
  - measures the signal's time-domain RMS instead of averaging dB-scaled frequency bins
  - normalizes it against a slowly decaying recent peak
  - treats anything below about -50 dBFS as silence
  - smooths it with a fast attack and a quicker release, so the mouth closes between syllables
- `@charivo/render-iki`, `@charivo/render-live2d`: the extra ×1.8 gain on the lip-sync value is gone, so both renderers share one scale.
- Visible effect on Web Speech: the simulator's values (0.3–1.0 per word) are unchanged, but without the renderer gain its mouth now spans that range instead of staying pinned near fully open.
