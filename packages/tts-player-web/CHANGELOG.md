# @charivo/tts-player-web

## 0.0.5

### Patch Changes

- Updated dependencies [ba07abf]
  - @charivo/core@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d773cca]
  - @charivo/core@0.3.0

## 0.0.3

### Patch Changes

- ca98036: Add explicit TTS player playback capabilities so `tts-core` can prefer
  `playbackMode` and `audioMimeType` over implicit detection. This also removes
  the old constructor-name and mime helper exports from `@charivo/tts-core`, so
  player implementations should declare their playback behavior explicitly.
- Updated dependencies [ca98036]
  - @charivo/core@0.2.0

## 0.0.2

### Patch Changes

- 0f9a342: Tighten the public core contracts around the event bus, render manager integration,
  and realtime session configuration. This release also republishes the affected
  public packages with corrected exports, type entrypoints, and package metadata so
  the published artifacts match the validated workspace builds.

  Additional fixes include end-to-end STT `language` forwarding for the remote flow,
  cleanup and lifecycle fixes in the web demo wiring, lower log noise in several
  packages, and improved Live2D package compatibility for bundled app builds.

- Updated dependencies [0f9a342]
  - @charivo/core@0.1.0
