# @charivo/core

## 0.5.0

### Minor Changes

- 18fd6e4: Add explicit realtime session refresh support through `updateSession(...)`,
  including reconnect-based config updates, refresh reasons on session lifecycle
  events, and manager reuse across refresh and recovery flows.

## 0.4.0

### Minor Changes

- ba07abf: Add a manager-owned realtime tool registry with normalized tool handler types,
  tool timeout and failure handling, manager-side built-in `setEmotion`
  post-processing, and transport-level `sendToolResult(...)` support for
  provider-specific realtime clients.

## 0.3.0

### Minor Changes

- d773cca: Introduce a provider-agnostic realtime foundation with normalized core types,
  stateful realtime manager APIs, an adapter-dispatched
  `realtime-client-remote` package, and a new
  `realtime-provider-openai` server package.

## 0.2.0

### Minor Changes

- ca98036: Add explicit TTS player playback capabilities so `tts-core` can prefer
  `playbackMode` and `audioMimeType` over implicit detection. This also removes
  the old constructor-name and mime helper exports from `@charivo/tts-core`, so
  player implementations should declare their playback behavior explicitly.

## 0.1.0

### Minor Changes

- 0f9a342: Tighten the public core contracts around the event bus, render manager integration,
  and realtime session configuration. This release also republishes the affected
  public packages with corrected exports, type entrypoints, and package metadata so
  the published artifacts match the validated workspace builds.

  Additional fixes include end-to-end STT `language` forwarding for the remote flow,
  cleanup and lifecycle fixes in the web demo wiring, lower log noise in several
  packages, and improved Live2D package compatibility for bundled app builds.
