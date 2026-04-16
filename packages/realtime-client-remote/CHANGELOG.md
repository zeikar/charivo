# @charivo/realtime-client-remote

## 0.4.1

### Patch Changes

- Updated dependencies [c2e1cb8]
  - @charivo/core@0.7.0
  - @charivo/realtime-core@0.5.0
  - @charivo/realtime-client-openai@0.2.3
  - @charivo/realtime-client-openai-agents@0.2.1

## 0.4.0

### Minor Changes

- ec19d59: Add an OpenAI Agents SDK based realtime client, switch the default remote
  OpenAI WebRTC adapter to the new agents path, and extend realtime session
  bootstrap contracts to support ephemeral client secrets alongside legacy SDP
  bootstraps.

### Patch Changes

- Updated dependencies [ec19d59]
  - @charivo/core@0.6.0
  - @charivo/shared@0.1.1
  - @charivo/realtime-client-openai-agents@0.2.0
  - @charivo/realtime-client-openai@0.2.2
  - @charivo/realtime-core@0.4.1

## 0.3.1

### Patch Changes

- Updated dependencies [18fd6e4]
  - @charivo/core@0.5.0
  - @charivo/realtime-core@0.4.0
  - @charivo/realtime-client-openai@0.2.1

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
