# @charivo/render

## 0.14.0

### Minor Changes

- 4e245ba: Charivo is now the body and the conversation brain is an adapter. See `docs/history/brain-body-migration.md` for the before/after of every change below.

  **Body API on `Charivo`** (`@charivo/core`): `perform({ text, origin?, whenBusy?, affect? })` speaks a string or a text stream on one floor and returns a `PerformanceHandle` (`started`, `done` with `heardText`, `result`, `cancel()`). Streams are cut at sentence ends, and each segment is announced with the new `performance:segment` event. `react()` shows a non-verbal reaction without taking the floor; its handle releases only its own claims, and `critical` (reflex only) also cancels the line on the floor. `getFloor()` and the new `floor:changed` event report `idle`, `speaking` or `realtime`, and `setAffectMap()` maps semantic affect labels to the model's expressions and motions. `performance:start` gains `text` and `affectResolved`; `performance:end` gains `heardText` and `error`. A failed TTS stop is remembered: no other voice starts until that manager confirms a stop.

  **Brain port**: `ConversationBrain`, `BrainTurn` and `BrainTurnResult`, with `attachBrain()`, `detachBrain()`, `getBrain()` and the `brain` option on `createCharivo`.

  **Cascade brain** (`@charivo/llm`): `createCascadeBrain(llm, { review? })` runs the LLM turn on top of the body: latest-wins submission, history in call order, rollback of replies nobody heard, the `respond` (`must` / `auto` / `silent`) and `history` (`keep` / `ephemeral` / `replaceKey`) policies of typed inputs, a `review` hook between the reply and speech, and tool-chosen expressions shown with the line. `LLMManager` gains `GenerateResponseOptions.interceptProjection` and `standalone` history entries, which pruning never treats as replies that lost their prompt.

  **Avatar** (`@charivo/avatar`): `connectAvatarDirectorToPerformances(bus, director)` drives the text-driven avatar director from performance events, and `director.say(text, { performanceId })` ties the inferred expression to that performance.

  **Render** (`@charivo/render`): claims and `avatar:release` may carry a `claimId`; a release that names one ends only the claim accepted with that id.

  **Breaking changes**
  - `userSay()`, `attachLLM()`, `detachLLM()`, `getLLMManager()`, `clearHistory()`, `getHistory()` and the `llm` option are removed from `Charivo`. Use `createCharivo({ brain: createCascadeBrain(llm) })` and `charivo.getBrain()`.
  - The `character:speak`, `tts:start`, `tts:end` and `tts:error` events are removed. Use `performance:start` / `performance:end`.
  - `turn:cancelled` now carries `{ turnId }` instead of `{ userMessageId }`.
  - `charivo.interrupt()` now stops speech only; cancel a turn that is still generating with `turn.cancel()` or `brain.interrupt()`.
  - User messages are no longer rendered; read them from `message:sent`.
  - `connectAvatarDirectorToCascade` is removed; use `connectAvatarDirectorToPerformances`.
  - `attachRealtime()` throws while a performance holds the floor or cancelled speech has not been confirmed stopped, and `perform()` throws while realtime is attached.
  - `dispose()` now rejects with a `CharivoDisposeError` (`CHARIVO_DISPOSE_ERROR`) for every failure, with the original error as `cause`; a typed `CharivoError` no longer passes through with its own code.
  - `perform()` and `attachRealtime()` throw `CharivoStateError` from a `dispose()` call until its teardown is done, and overlapping `dispose()` calls share one promise.

### Patch Changes

- Updated dependencies [4e245ba]
  - @charivo/core@0.42.0

## 0.13.2

### Patch Changes

- Updated dependencies [c85279f]
  - @charivo/core@0.41.0

## 0.13.1

### Patch Changes

- Updated dependencies [f21917b]
  - @charivo/core@0.40.0

## 0.13.0

### Minor Changes

- 94938cb: Avatar control is now arbitrated per channel. Several writers, such as an app reflex, an LLM tool call and the text-driven avatar director, no longer overwrite each other, and a hold now follows the speech it belongs to.
  - `@charivo/core`:
    - `avatar:expression` and `avatar:gaze` take optional claim fields: `source` (default `"app"`), `priority` (`"reflex" | "explicit" | "inferred" | "ambient"`, default `"explicit"`) and `hold` (`{ ms }`, `"until-release"` or `{ performance }`).
    - `avatar:motion` takes an optional `priority`.
    - New events:
      - `avatar:release { source, channel? }`
      - `performance:start { performanceId, origin, voiced }`
      - `performance:end { performanceId, origin, status }`
    - `Renderer.playMotionByGroup` takes `priority?: MotionPriority` and may return `false` when it declines the motion (returning nothing still means accepted), and `Renderer` gains an optional `clearGaze()`.
  - `@charivo/render`:
    - **Arbitration rules:** `RenderManager` keeps a claim stack for expression and for gaze. The highest live priority wins, and a tie goes to the newest. A source replaces its own claim. When a claim ends, the channel falls back to the next live claim, then to the base face or gaze.
    - **Default holds:** an expression with no hold lasts for the speech it is bound to. Before any speech starts, it gets an 8 s pre-speech window. A gaze claim defaults to 1,200 ms, and `clearGaze()` runs when the last gaze claim ends.
    - **Performance spans:** a voiced performance replaces the anonymous `tts:audio:*` span. A claim tied to a performance that has already ended is ignored.
    - **Motions:**
      - Priority maps to the renderer as reflex → force, explicit and inferred → normal, and ambient → idle.
      - Reflex motions skip the 1 s same-motion debounce.
      - Ambient motions do not start the debounce.
    - **Model loads:** a load releases held claims, and avatar events are ignored while the latest `loadModel()` is pending.
    - **Behaviour changes:**
      - A repeated expression or gaze target refreshes its hold instead of replaying.
      - An unrelated `tts:audio:end` no longer releases a claim with its own hold.
      - AI gaze is a claim instead of a fixed mouse-suspend window.
  - `@charivo/render-live2d`: motion priority maps onto Cubism's force, normal and idle priorities, and the model's own reservation decides admission. `clearGaze()` recentres the gaze.
  - `@charivo/render-iki`:
    - **Engine:** requires `@ikijs/engine` ^0.13.0 and `@ikijs/format` ^0.12.0.
    - **Motion priority:** a lower-priority motion is declined while the clip the adapter started is still running, as reported by `IkiMotion.activeMotion()`.
    - **Loads:** a newer `loadModel()` cancels an older load still being adopted, through `IkiPlayer.cancelLoad()`.
    - **Gaze:** `clearGaze()` calls `clearGazeTarget()`. Under a declared `Idle` group the engine now drives the eyes itself, so the adapter no longer writes `EyeballX` or `EyeballY`.
  - `@charivo/avatar`:
    - Tool projections are tagged `source: "tool"`, `priority: "explicit"`.
    - The text-driven avatar director is tagged `source: "avatar-director"`, `priority: "inferred"`, so an explicit expression outranks the director's expression.

### Patch Changes

- Updated dependencies [94938cb]
  - @charivo/core@0.39.0

## 0.12.2

### Patch Changes

- b4bc9f3: Describe each package on npm by what it does for Live2D and Iki AI characters and which providers it supports, instead of only naming it as part of Charivo.
- Updated dependencies [b4bc9f3]
  - @charivo/core@0.38.1

## 0.12.1

### Patch Changes

- 9b354de: `createRenderManager()` returns a manager whose `loadModel`, `setLocalGaze` and `setMessageCallback` are required in the type, following `RenderManager` in `@charivo/core`: calling them needs no `?.`. The methods were always there and behave as before. Upgrade together with `@charivo/core`.
- Updated dependencies [9b354de]
  - @charivo/core@0.38.0

## 0.12.0

### Minor Changes

- 2f522f7: Add `setGazeOrigin(origin?)`: the point of the model the cursor-follow gaze is measured from. Until now a pointer was read against the canvas's centre, which on a full-body model is the waist, so a pointer on the face counted as above it and the character looked up. `@charivo/render` declares it as an optional `MouseTrackable` method with the `GazeOrigin` type — fractions of the model's own canvas, `(0, 0)` its top-left corner and `(1, 1)` its bottom-right, the same for any renderer — and `@charivo/render-live2d` implements it. Unset, the gaze is measured from the centre as before; taps and `lookAt` are unaffected; a renderer that does not implement it keeps working.

## 0.11.6

### Patch Changes

- Updated dependencies [62832d6]
  - @charivo/core@0.37.0

## 0.11.5

### Patch Changes

- Updated dependencies [0758343]
  - @charivo/core@0.36.0

## 0.11.4

### Patch Changes

- Updated dependencies [26a0818]
  - @charivo/core@0.35.0

## 0.11.3

### Patch Changes

- Updated dependencies [cc9f3b9]
  - @charivo/core@0.34.0

## 0.11.2

### Patch Changes

- Updated dependencies [8266797]
  - @charivo/core@0.33.0

## 0.11.1

### Patch Changes

- Updated dependencies [e5ea6b7]
  - @charivo/core@0.32.0

## 0.11.0

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

## 0.10.8

### Patch Changes

- Updated dependencies [03d3d46]
  - @charivo/core@0.30.0

## 0.10.7

### Patch Changes

- Updated dependencies [7884f77]
  - @charivo/core@0.29.0

## 0.10.6

### Patch Changes

- Updated dependencies [13c3c3b]
  - @charivo/core@0.28.0

## 0.10.5

### Patch Changes

- Updated dependencies [f2ddcbe]
- Updated dependencies [8dbacf9]
- Updated dependencies [8dbacf9]
  - @charivo/core@0.27.0

## 0.10.4

### Patch Changes

- Updated dependencies [1cb4c27]
- Updated dependencies [22a8f65]
  - @charivo/core@0.26.0

## 0.10.3

### Patch Changes

- 04e8550: Stop the expression hold window from cutting a face back mid-sentence.

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

## 0.10.2

### Patch Changes

- Updated dependencies [7198359]
  - @charivo/core@0.25.0

## 0.10.1

### Patch Changes

- Updated dependencies [e1257cf]
  - @charivo/core@0.24.0

## 0.10.0

### Minor Changes

- f66cc8f: Expressions set via `avatar:expression` now also release when `tts:audio:end`
  arrives, in addition to the existing ~8-second hold — whichever happens
  first. The hold is still armed for every accepted expression on renderers
  that implement `stopExpression`; a renderer without it remains a silent
  no-op, unchanged. The hold ceiling runs independently of `tts:audio:end`, so
  it still fires mid-speech for utterances that outlast it, and it remains the
  only release trigger for setups that never emit audio events (e.g. text-only
  LLM configurations). The release fade mechanics — fading over the
  expression's `FadeOutTime`, waiting for a pending fade-in to finish first,
  and `Overwrite` parameters snapping — are unchanged.

### Patch Changes

- Updated dependencies [f7caf22]
  - @charivo/core@0.23.0

## 0.9.0

### Minor Changes

- 0727621: Expressions set via `avatar:expression` are now released automatically
  about 8 seconds after they are applied: the model fades back to its base
  face over the expression's `FadeOutTime` (1 second when the `.exp3.json`
  does not specify one) while idle motion, eye blink, and breath keep
  running. Parameters using the `Add` or `Multiply` blend fade smoothly when
  their release duration is positive (an authored `FadeOutTime: 0` releases
  instantly); parameters using `Overwrite` snap to their base value (the SDK
  rebases overwrite values every frame). A release requested before the
  expression has finished fading in waits for the fade-in to complete before
  fading out, so an expression can remain visible beyond the nominal
  8-second hold. This is on by default when using `@charivo/render` with
  `@charivo/render-live2d`; previously an expression persisted until
  something else replaced it. The hold is a fixed internal duration — there
  is no configuration option for it yet.

  The `Renderer` interface in `@charivo/core` gains an optional
  `stopExpression()` method for releasing the active expression. If you
  implement a custom renderer, add `stopExpression()` to opt into automatic
  release; omitting it simply disables the release for that renderer.

### Patch Changes

- Updated dependencies [0727621]
  - @charivo/core@0.22.0

## 0.8.4

### Patch Changes

- 75174a1: Internal `@charivo/*` dependencies now publish as caret ranges (`workspace:^`) instead of exact pins (`workspace:*`), so a fresh install can dedupe this package against another compatible release of its `@charivo/*` dependencies instead of always nesting its own copy. While the workspace is on `0.x`, a caret range only spans patch releases of the same minor, so the full benefit lands once the affected packages reach `1.0.0` — installs mixing different `0.x` minors still nest separate copies today.

  Published tarballs also no longer include the `dist/metafile-*.json` build artifacts (esbuild bundle metadata used for internal build verification); they were never meant to ship to consumers.

- Updated dependencies [75174a1]
  - @charivo/core@0.21.0

## 0.8.3

### Patch Changes

- Updated dependencies [666a7d4]
- Updated dependencies [03559a9]
  - @charivo/core@0.20.0

## 0.8.2

### Patch Changes

- Updated dependencies [370dfdc]
  - @charivo/core@0.19.0

## 0.8.1

### Patch Changes

- Updated dependencies [5d949a9]
  - @charivo/core@0.18.0

## 0.8.0

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

## 0.7.0

### Minor Changes

- f54cf31: Unify lip-sync audio analysis behind one shared analyzer in `@charivo/core`.

  `createLipSyncAnalyzer` (speech-band RMS, `min(rms * 1.7, 1)`) is now the single
  implementation used by every lip-sync producer: the TTS manager analyzes the
  `<audio>` element it plays for `"audio"` playback mode, and both realtime
  clients analyze their incoming `MediaStream`. All producers emit
  `tts:lipsync:update`; `RenderManager` stays a pure consumer that toggles
  `setRealtimeLipSync` and feeds `updateRealtimeLipSyncRms` from that event — it
  no longer analyzes audio itself.

  Breaking changes:
  - `tts:audio:start` no longer carries `audioElement`; the payload is now
    `{ characterId? }`.
  - `RenderManager.prepareAudio` is removed. Use `TTSManager.prepareAudio?.()`
    and/or `RealtimeManager.prepareAudio?.()` instead, from the same
    user-gesture handler that previously called
    `renderManager.prepareAudio?.()`. With `@charivo/realtime/remote`,
    `RealtimeManager.prepareAudio?.()` needs the same `RealtimeSessionConfig`
    you pass to `startSession()` to resolve which adapter to prepare — build
    one config and pass it to both:
    `await manager.prepareAudio?.(sessionConfig);` then
    `await manager.startSession(sessionConfig);`.
  - `"audio"` playback mode now requires the `TTSPlayer` to implement
    `generateAudio()`. `createTTSManager(player)` throws an explicit error for
    an `"audio"`-mode player that lacks it, instead of silently playing without
    lip-sync. Players that only implement `speak()` (e.g. the Web Speech API)
    must use `"web-speech"` mode, whose lip-sync comes from a text-driven
    simulation.

  Also adds `TTSManager.dispose?.()` to release lip-sync audio resources for
  apps that tear a `TTSManager` down outside `Charivo.dispose()` (which already
  calls it automatically).

### Patch Changes

- Updated dependencies [f54cf31]
  - @charivo/core@0.16.0

## 0.6.1

### Patch Changes

- Updated dependencies [2a4656a]
  - @charivo/core@0.15.0

## 0.6.0

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
