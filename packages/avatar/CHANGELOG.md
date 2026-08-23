# @charivo/avatar

## 0.4.0

### Minor Changes

- 21d19b3: Give motions descriptions, and stop tool-triggered motions from playing their baked-in audio

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

### Patch Changes

- 9d9ba15: Give the remaining packages npm keywords

  Only `@charivo/tts` and `@charivo/stt` carried `keywords`, so the other seven
  published packages were reachable on npm by name alone — including `core` and
  `render-live2d`, the two anyone looking for this project would search for
  first. Each now lists five, in the shape the existing two set: `charivo`, then
  what that package actually does.

  Manifest metadata only. No code, exports, or types change.

- Updated dependencies [21d19b3]
- Updated dependencies [9d9ba15]
  - @charivo/core@0.31.0

## 0.3.5

### Patch Changes

- Updated dependencies [03d3d46]
  - @charivo/core@0.30.0

## 0.3.4

### Patch Changes

- Updated dependencies [7884f77]
  - @charivo/core@0.29.0

## 0.3.3

### Patch Changes

- Updated dependencies [13c3c3b]
  - @charivo/core@0.28.0

## 0.3.2

### Patch Changes

- Updated dependencies [f2ddcbe]
- Updated dependencies [8dbacf9]
- Updated dependencies [8dbacf9]
  - @charivo/core@0.27.0

## 0.3.1

### Patch Changes

- Updated dependencies [1cb4c27]
- Updated dependencies [22a8f65]
  - @charivo/core@0.26.0

## 0.3.0

### Minor Changes

- 7198359: `AvatarControlCatalog` gains an optional `expressionDescriptions?: Record<string, string>`
  so a consumer can attach a human-readable meaning to each expression ID. Previously the
  `setExpression` tool exposed expression IDs to the model as a bare `enum` with a generic
  property description, so a model whose expression IDs are opaque — the Cubism sample
  models ship IDs like `F01`..`F08` — had nothing to choose on.

  When descriptions are supplied, `@charivo/avatar` appends the meanings to the
  `setExpression` `expressionId` parameter description and to `buildAvatarControlInstructions`
  output. Keys are intersected with `catalog.expressions` and emitted in that array's order,
  so unknown or stale keys are ignored and producers can pass a config through unfiltered;
  the intersection is enforced in one place rather than at each call site. The formatter
  itself stays internal — no new exports.

  Fully backward compatible: with the field absent, or present but with no key matching an
  available expression, both the tool schema and the instruction text are byte-identical to
  before, and a model that ships no expressions still omits everything expression-related.

### Patch Changes

- Updated dependencies [7198359]
  - @charivo/core@0.25.0

## 0.2.7

### Patch Changes

- Updated dependencies [e1257cf]
  - @charivo/core@0.24.0

## 0.2.6

### Patch Changes

- Updated dependencies [f7caf22]
  - @charivo/core@0.23.0

## 0.2.5

### Patch Changes

- Updated dependencies [0727621]
  - @charivo/core@0.22.0

## 0.2.4

### Patch Changes

- 75174a1: Internal `@charivo/*` dependencies now publish as caret ranges (`workspace:^`) instead of exact pins (`workspace:*`), so a fresh install can dedupe this package against another compatible release of its `@charivo/*` dependencies instead of always nesting its own copy. While the workspace is on `0.x`, a caret range only spans patch releases of the same minor, so the full benefit lands once the affected packages reach `1.0.0` — installs mixing different `0.x` minors still nest separate copies today.

  Published tarballs also no longer include the `dist/metafile-*.json` build artifacts (esbuild bundle metadata used for internal build verification); they were never meant to ship to consumers.

- Updated dependencies [75174a1]
  - @charivo/core@0.21.0

## 0.2.3

### Patch Changes

- Updated dependencies [666a7d4]
- Updated dependencies [03559a9]
  - @charivo/core@0.20.0

## 0.2.2

### Patch Changes

- Updated dependencies [370dfdc]
  - @charivo/core@0.19.0

## 0.2.1

### Patch Changes

- Updated dependencies [5d949a9]
  - @charivo/core@0.18.0

## 0.2.0

### Minor Changes

- 87ac34f: Bring tool-based avatar control (expression / motion / gaze) to the text LLM path, sharing one tool architecture with realtime sessions.
  - New `@charivo/avatar` package: catalog-constrained avatar tool builders (`createAvatarControlTools`, `buildAvatarControlInstructions`, `createAvatarResultProjector`) depending only on `@charivo/core`, usable by both realtime and LLM sessions.
  - `@charivo/realtime-avatar` is deprecated and now re-exports `@charivo/avatar`; migrate imports (`RealtimeToolResultProjector` → core `ToolResultProjector`).
  - LLM contracts gain optional tool calling: `LLMClient.callWithTools` / `LLMProvider.generateResponseWithTools`, role-discriminated `LLMMessage`, `LLMToolCall`, `LLMToolResponse`. `LLMManager` gains a tool registry (`tools`, `resultProjectors`, `toolInstructions`, `defaultToolTimeoutMs` options plus `registerTool`/`unregisterTool`/`getRegisteredTools`/`setToolInstructions`/`setEventEmitter`) with a validated 3-round execution loop, `avatar:*` event projection, and `Charivo.attachLLM` emitter wiring. Tool turns are not persisted to history; tool-less usage is unchanged.
  - OpenAI/OpenClaw providers and the remote client implement tool calling with validated wire DTOs; the remote `/api/chat` protocol gains `tools` in the request and `toolCalls` in the response.
  - Core tool contracts generalized to neutral names (`ToolDefinition`/`ToolContext`/`ToolHandler`/`ToolRegistration`/`ToolResultProjector`) with shared `validateToolArguments`/`assertToolResultObject`; `Realtime*` tool names remain as deprecated interfaces/aliases.
  - Breaking (pre-1.0 minor): the `realtime:expression|motion|gaze` events are renamed to `avatar:expression|motion|gaze`; avatar helpers should be imported from `@charivo/avatar`.

### Patch Changes

- Updated dependencies [87ac34f]
  - @charivo/core@0.17.0
