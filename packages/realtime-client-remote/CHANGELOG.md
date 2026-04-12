# @charivo/realtime-client-remote

## 0.3.0

### Minor Changes

- ba07abf: Add a manager-owned realtime tool registry with normalized tool handler types,
  tool timeout and failure handling, manager-side built-in `setEmotion`
  post-processing, and transport-level `sendToolResult(...)` support for
  provider-specific realtime clients.

### Patch Changes

- Updated dependencies [ba07abf]
  - @charivo/core@0.4.0
  - @charivo/realtime-core@0.3.0
  - @charivo/realtime-client-openai@0.2.0

## 0.2.0

### Minor Changes

- d773cca: Introduce a provider-agnostic realtime foundation with normalized core types,
  stateful realtime manager APIs, an adapter-dispatched
  `realtime-client-remote` package, and a new
  `realtime-provider-openai` server package.

### Patch Changes

- Updated dependencies [d773cca]
  - @charivo/core@0.3.0
  - @charivo/realtime-core@0.2.0
  - @charivo/realtime-client-openai@0.1.0
  - @charivo/shared@0.1.0
