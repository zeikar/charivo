# @charivo/render

## 0.5.0

### Minor Changes

- f82ba6f: Add `RenderManager.setLocalGaze(coords)` — a public local-presence gaze entry point (e.g. webcam face tracking) that drives the avatar's gaze as a peer of mouse-tracking. Returns `false` while AI gaze owns the avatar or when the renderer has no `lookAt`; it suspends mouse cursor tracking (not taps) through a separate window so a local-presence driver beats the cursor while still yielding to AI gaze.

### Patch Changes

- Updated dependencies [f82ba6f]
  - @charivo/core@0.14.0

## 0.4.0

### Minor Changes

- 5a86dee: RenderManager now exposes `disconnect()` and tears down its event-bus listeners on detach/replace/destroy, fixing leaked/duplicate renderer calls.

### Patch Changes

- Updated dependencies [5a86dee]
  - @charivo/core@0.13.0

## 0.3.4

### Patch Changes

- Updated dependencies [8f7d277]
  - @charivo/core@0.12.0

## 0.3.3

### Patch Changes

- Updated dependencies [8826f2b]
  - @charivo/core@0.11.0

## 0.3.2

### Patch Changes

- Updated dependencies [79df4cc]
  - @charivo/core@0.10.0

## 0.3.1

### Patch Changes

- Updated dependencies [7d6608f]
  - @charivo/core@0.9.0

## 0.3.0

### Minor Changes

- 3aa84ad: Improve mobile realtime resilience by adding reconnect orchestration, reconnect
  observability events, direct microphone ownership with safer browser
  constraints, and iOS-friendly audio preparation hooks.

  `@charivo/render-live2d` now handles WebGL context loss by rebuilding the host
  and reloading the last model after restore. `@charivo/stt` now requests
  browser-safe microphone constraints by default.

### Patch Changes

- Updated dependencies [3aa84ad]
  - @charivo/core@0.8.0

## 0.2.0

### Minor Changes

- defca13: Consolidate the public package surface into coarse modality packages and a subpath-only server package.

  This release removes the old fine-grained package names in favor of:
  - `@charivo/llm`
  - `@charivo/tts`
  - `@charivo/stt`
  - `@charivo/realtime`
  - `@charivo/render`
  - `@charivo/server`

  It also moves adapter/provider entrypoints to subpaths, keeps `@charivo/render-live2d` separate, and documents that consumers need `moduleResolution: "bundler" | "node16" | "nodenext"` for package subpath exports.

## 0.2.0

### Minor Changes

- c2e1cb8: Add canonical avatar control support with expression, motion, and gaze events/tools, and remove the legacy emotion-based avatar control surface.

### Patch Changes

- Updated dependencies [c2e1cb8]
  - @charivo/core@0.7.0

## 0.1.5

### Patch Changes

- Updated dependencies [ec19d59]
  - @charivo/core@0.6.0

## 0.1.4

### Patch Changes

- Updated dependencies [18fd6e4]
  - @charivo/core@0.5.0

## 0.1.3

### Patch Changes

- Updated dependencies [ba07abf]
  - @charivo/core@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [d773cca]
  - @charivo/core@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [ca98036]
  - @charivo/core@0.2.0

## 0.1.0

### Minor Changes

- 0f9a342: Tighten the public core contracts around the event bus, render manager integration,
  and realtime session configuration. This release also republishes the affected
  public packages with corrected exports, type entrypoints, and package metadata so
  the published artifacts match the validated workspace builds.

  Additional fixes include end-to-end STT `language` forwarding for the remote flow,
  cleanup and lifecycle fixes in the web demo wiring, lower log noise in several
  packages, and improved Live2D package compatibility for bundled app builds.

### Patch Changes

- Updated dependencies [0f9a342]
  - @charivo/core@0.1.0
