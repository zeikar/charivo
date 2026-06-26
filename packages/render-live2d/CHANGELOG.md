# @charivo/render-live2d

## 0.3.0

### Minor Changes

- f018bed: Lock the public API surface to factory-only ahead of 1.0.

  Browser clients, players, transcribers, managers, and renderers are no longer
  exported as concrete classes — create them via their `create*` factory, which
  now returns the public interface (`LLMClient`, `TTSPlayer`, `STTTranscriber`,
  `RealtimeTransportClient`, `Renderer`, and a new public `Live2DRenderer`
  interface) rather than the implementation class.
  - `@charivo/llm`: root is factory-only (`createLLMManager` + `LLMManagerOptions`); the internal builder helpers (`CharacterPromptBuilder`, `MessageConverter`, `ResponseMessageBuilder`, `LLMValidators`, `MessageHistoryManager`) and the direct client classes are no longer exported.
  - `@charivo/tts` / `@charivo/stt`: roots are factory-only; player/transcriber classes, `STTManagerImpl`, and internal helpers (`MediaRecorderHelper`, `WebSpeechLipSyncSimulator`, tts-utils) are no longer exported.
  - `@charivo/realtime`: `RealtimeManagerImpl` and the transport client classes (`RemoteRealtimeClient`, `OpenAIRealtimeClient`, `OpenAIRealtimeAgentsClient`) are no longer exported.
  - `@charivo/render`: `RenderManager` and `RealTimeLipSync` are no longer exported; `@charivo/render/stub` adds a `createConsoleRenderer()` factory and hides `ConsoleRenderer`.
  - `@charivo/render-live2d`: the concrete renderer class is hidden behind a new public `Live2DRenderer` interface; construct via `createLive2DRenderer()`.

  Migration: replace any `new <Class>(...)` / direct class import from these packages with the corresponding `create*` factory. Factory and config/options type names are unchanged. The one capability that did not move to an instance method — the Web Speech support check previously reachable via `new WebSTTTranscriber().isSupportedBrowser()` — is now the standalone, SSR-safe `isWebSTTSupported()` export from `@charivo/stt/web`.

### Patch Changes

- Updated dependencies [f018bed]
  - @charivo/render@0.6.0

## 0.2.9

### Patch Changes

- Updated dependencies [f82ba6f]
  - @charivo/core@0.14.0
  - @charivo/render@0.5.0

## 0.2.8

### Patch Changes

- Updated dependencies [5a86dee]
- Updated dependencies [5a86dee]
  - @charivo/core@0.13.0
  - @charivo/render@0.4.0

## 0.2.7

### Patch Changes

- b32f93d: Ease parameters back to their default rest pose when a motion finishes and the model has no `Idle` motion group to take over. Previously a model without an `Idle` group froze on the last frame of a finished one-shot motion (e.g. an arm left raised after a wave), because the load/save parameter cycle baked in the pose. Models that ship an `Idle` group are unaffected.

## 0.2.6

### Patch Changes

- Updated dependencies [8f7d277]
  - @charivo/core@0.12.0
  - @charivo/render@0.3.4

## 0.2.5

### Patch Changes

- Updated dependencies [8826f2b]
  - @charivo/core@0.11.0
  - @charivo/render@0.3.3

## 0.2.4

### Patch Changes

- Updated dependencies [79df4cc]
  - @charivo/core@0.10.0
  - @charivo/render@0.3.2

## 0.2.3

### Patch Changes

- Updated dependencies [7d6608f]
  - @charivo/core@0.9.0
  - @charivo/render@0.3.1

## 0.2.2

### Patch Changes

- 42ea16b: Fix packaging regression where the declaration build emitted `renderer.d.ts`
  under `dist/render-live2d/src/` instead of the `dist/src/` path declared in
  `package.json`, breaking `pack:check` and leaving published type entries
  unresolved.
- 3aa84ad: Improve mobile realtime resilience by adding reconnect orchestration, reconnect
  observability events, direct microphone ownership with safer browser
  constraints, and iOS-friendly audio preparation hooks.

  `@charivo/render-live2d` now handles WebGL context loss by rebuilding the host
  and reloading the last model after restore. `@charivo/stt` now requests
  browser-safe microphone constraints by default.

- Updated dependencies [3aa84ad]
  - @charivo/core@0.8.0
  - @charivo/render@0.3.0

## 0.2.1

### Patch Changes

- defca13: Consolidate the public package surface into coarse modality packages and a subpath-only server package.

  This release removes the old fine-grained package names in favor of:
  - `@charivo/llm`
  - `@charivo/tts`
  - `@charivo/stt`
  - `@charivo/realtime`
  - `@charivo/render`
  - `@charivo/server`

  It also moves adapter/provider entrypoints to subpaths, keeps `@charivo/render-live2d` separate, and documents that consumers need `moduleResolution: "bundler" | "node16" | "nodenext"` for package subpath exports.

- Updated dependencies [defca13]
  - @charivo/render@0.2.0

## 0.2.0

### Minor Changes

- c2e1cb8: Add canonical avatar control support with expression, motion, and gaze events/tools, and remove the legacy emotion-based avatar control surface.

### Patch Changes

- Updated dependencies [c2e1cb8]
  - @charivo/core@0.7.0
  - @charivo/render-core@0.2.0

## 0.1.6

### Patch Changes

- Updated dependencies [ec19d59]
  - @charivo/core@0.6.0
  - @charivo/render-core@0.1.5

## 0.1.5

### Patch Changes

- Updated dependencies [18fd6e4]
  - @charivo/core@0.5.0
  - @charivo/render-core@0.1.4

## 0.1.4

### Patch Changes

- Updated dependencies [ba07abf]
  - @charivo/core@0.4.0
  - @charivo/render-core@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [d773cca]
  - @charivo/core@0.3.0
  - @charivo/render-core@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [ca98036]
  - @charivo/core@0.2.0
  - @charivo/render-core@0.1.1

## 0.1.1

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
  - @charivo/render-core@0.1.0
