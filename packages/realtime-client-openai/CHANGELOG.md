# @charivo/realtime-client-openai

## 0.2.1

### Patch Changes

- Updated dependencies [18fd6e4]
  - @charivo/core@0.5.0
  - @charivo/realtime-core@0.4.0

## 0.2.0

### Minor Changes

- ba07abf: Add a manager-owned realtime tool registry with normalized tool handler types,
  tool timeout and failure handling, manager-side built-in `setEmotion`
  post-processing, and transport-level `sendToolResult(...)` support for
  provider-specific realtime clients.

### Patch Changes

- Updated dependencies [ba07abf]
  - @charivo/core@0.4.0
  - @charivo/realtime-core@0.3.0

## 0.1.0

### Minor Changes

- d773cca: Introduce a provider-agnostic realtime foundation with normalized core types,
  stateful realtime manager APIs, an adapter-dispatched
  `realtime-client-remote` package, and a new
  `realtime-provider-openai` server package.

### Patch Changes

- Updated dependencies [d773cca]
  - @charivo/core@0.3.0
  - @charivo/realtime-core@0.2.0
  - @charivo/shared@0.1.0

## 0.0.3

### Patch Changes

- Updated dependencies [ca98036]
  - @charivo/core@0.2.0
  - @charivo/realtime-core@0.1.1

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
  - @charivo/realtime-core@0.1.0
