---
"@charivo/core": minor
"@charivo/render": minor
"@charivo/render-live2d": minor
"@charivo/render-iki": minor
"@charivo/avatar": minor
---

Avatar control is now arbitrated per channel. Several writers, such as an app reflex, an LLM tool call and the text-driven avatar director, no longer overwrite each other, and a hold now follows the speech it belongs to.

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
