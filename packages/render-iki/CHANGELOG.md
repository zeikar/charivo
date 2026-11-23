# @charivo/render-iki

## 0.3.0

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
  - @charivo/render@0.13.0

## 0.2.1

### Patch Changes

- b4bc9f3: Describe each package on npm by what it does for Live2D and Iki AI characters and which providers it supports, instead of only naming it as part of Charivo.
- Updated dependencies [b4bc9f3]
  - @charivo/core@0.38.1
  - @charivo/render@0.12.2

## 0.2.0

### Minor Changes

- 9b354de: Members that were always present are now required in the types, so calling them needs no `?.`: `loadModel`, `setLocalGaze` and `setMessageCallback` on `RenderManager`, and `loadModel` on `Live2DRenderer` and `IkiRenderer`. Nothing changes at runtime: the manager from `createRenderManager` and both renderers always had these methods, and the manager still resolves `loadModel` without loading anything when its renderer has none. Existing `?.` calls keep compiling, and `Renderer.loadModel` stays optional for a renderer of your own.

  What breaks is code that produces one of the three types itself: a hand-written `RenderManager` must now declare `loadModel`, `setLocalGaze` and `setMessageCallback`, and a class or test double typed as `Live2DRenderer` or `IkiRenderer` must declare `loadModel`. Upgrade the `@charivo/*` packages together: an older `@charivo/render` beside this `@charivo/core` keeps its own copy of the core types, and the manager it returns no longer type-checks against `createCharivo({ renderer })` or `attachRenderer`.

### Patch Changes

- Updated dependencies [9b354de]
- Updated dependencies [9b354de]
  - @charivo/core@0.38.0
  - @charivo/render@0.12.1

## 0.1.0

### Minor Changes

- 1288f3f: First release on npm. `@charivo/render-iki` draws an `.iki` model on the open [Iki](https://github.com/zeikar/iki) engine through the same `Renderer` and `MouseTrackable` contracts as `@charivo/render-live2d`, so `createIkiRenderer({ canvas })` takes the place of `createLive2DRenderer` under `@charivo/render` with lip-sync, expressions, motions, gaze and the avatar control catalog. The package exports the `createIkiRenderer` factory and the `IkiRenderer`, `IkiRendererOptions` and `IkiView` types; it is browser-only, ESM-only and MIT.

## 0.0.25

### Patch Changes

- Updated dependencies [2f522f7]
  - @charivo/render@0.12.0

## 0.0.24

### Patch Changes

- Updated dependencies [62832d6]
  - @charivo/core@0.37.0
  - @charivo/render@0.11.6

## 0.0.23

### Patch Changes

- Updated dependencies [0758343]
  - @charivo/core@0.36.0
  - @charivo/render@0.11.5

## 0.0.22

### Patch Changes

- Updated dependencies [26a0818]
  - @charivo/core@0.35.0
  - @charivo/render@0.11.4

## 0.0.21

### Patch Changes

- Updated dependencies [cc9f3b9]
  - @charivo/core@0.34.0
  - @charivo/render@0.11.3

## 0.0.20

### Patch Changes

- Updated dependencies [8266797]
  - @charivo/core@0.33.0
  - @charivo/render@0.11.2

## 0.0.19

### Patch Changes

- Updated dependencies [e5ea6b7]
  - @charivo/core@0.32.0
  - @charivo/render@0.11.1

## 0.0.18

### Patch Changes

- Updated dependencies [21d19b3]
- Updated dependencies [9d9ba15]
  - @charivo/core@0.31.0
  - @charivo/render@0.11.0

## 0.0.17

### Patch Changes

- Updated dependencies [03d3d46]
  - @charivo/core@0.30.0
  - @charivo/render@0.10.8

## 0.0.16

### Patch Changes

- Updated dependencies [7884f77]
  - @charivo/core@0.29.0
  - @charivo/render@0.10.7

## 0.0.15

### Patch Changes

- Updated dependencies [13c3c3b]
  - @charivo/core@0.28.0
  - @charivo/render@0.10.6

## 0.0.14

### Patch Changes

- Updated dependencies [f2ddcbe]
- Updated dependencies [8dbacf9]
- Updated dependencies [8dbacf9]
  - @charivo/core@0.27.0
  - @charivo/render@0.10.5

## 0.0.13

### Patch Changes

- Updated dependencies [1cb4c27]
- Updated dependencies [22a8f65]
  - @charivo/core@0.26.0
  - @charivo/render@0.10.4

## 0.0.12

### Patch Changes

- Updated dependencies [7198359]
  - @charivo/core@0.25.0
  - @charivo/render@0.10.2

## 0.0.11

### Patch Changes

- Updated dependencies [e1257cf]
  - @charivo/core@0.24.0
  - @charivo/render@0.10.1

## 0.0.10

### Patch Changes

- Updated dependencies [f7caf22]
- Updated dependencies [f66cc8f]
  - @charivo/core@0.23.0
  - @charivo/render@0.10.0

## 0.0.9

### Patch Changes

- Updated dependencies [0727621]
  - @charivo/core@0.22.0
  - @charivo/render@0.9.0

## 0.0.8

### Patch Changes

- Updated dependencies [75174a1]
- Updated dependencies [75174a1]
  - @charivo/core@0.21.0
  - @charivo/render@0.8.4

## 0.0.7

### Patch Changes

- Updated dependencies [666a7d4]
- Updated dependencies [03559a9]
  - @charivo/core@0.20.0
  - @charivo/render@0.8.3

## 0.0.6

### Patch Changes

- Updated dependencies [370dfdc]
  - @charivo/core@0.19.0
  - @charivo/render@0.8.2

## 0.0.5

### Patch Changes

- Updated dependencies [5d949a9]
  - @charivo/core@0.18.0
  - @charivo/render@0.8.1

## 0.0.4

### Patch Changes

- Updated dependencies [87ac34f]
  - @charivo/core@0.17.0
  - @charivo/render@0.8.0

## 0.0.3

### Patch Changes

- Updated dependencies [f54cf31]
  - @charivo/core@0.16.0
  - @charivo/render@0.7.0

## 0.0.2

### Patch Changes

- Updated dependencies [2a4656a]
  - @charivo/core@0.15.0
  - @charivo/render@0.6.1

## 0.0.1

### Patch Changes

- Updated dependencies [f018bed]
  - @charivo/render@0.6.0
