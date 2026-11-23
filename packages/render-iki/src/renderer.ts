import type {
  AvatarControlCatalog,
  GazeCoordinates,
  MotionPriority,
  Renderer,
} from "@charivo/core";
import type { GazeOrigin, MouseTrackable } from "@charivo/render";
import type { IkiView } from "@ikijs/engine";

import { IkiRendererImpl } from "./iki-renderer";

export type { IkiView };

export interface IkiRendererOptions {
  canvas?: HTMLCanvasElement;
}

export interface IkiRenderer extends Renderer, MouseTrackable {
  loadModel(modelPath: string): Promise<void>;
  playExpression(expressionId: string): void;
  stopExpression(): void;
  /**
   * `options.priority` (default `"normal"`) is weighed against the clip this
   * renderer started, for as long as the engine still runs it: a request of
   * lower priority is declined, an equal or higher one replaces the clip.
   * `"force"` therefore always plays, and `"idle"` is declined (not queued)
   * while a `"normal"` or `"force"` clip runs. `options.muteSound` is accepted for the `Renderer`
   * contract and ignored: Iki motion clips carry no audio.
   * Returns `false` when the motion was declined.
   */
  playMotionByGroup(
    group: string,
    index: number,
    options?: { muteSound?: boolean; priority?: MotionPriority },
  ): boolean;
  lookAt(coords: GazeCoordinates): void;
  /**
   * Drop the target a `lookAt` or the mouse set: the eyes spring back to the
   * engine's idle gaze (under an `Idle` motion group, to what its clips
   * write, else to their resting values), and the next model loaded is not
   * handed it.
   */
  clearGaze(): void;
  setGazeOrigin(origin?: GazeOrigin): void;
  getAvailableExpressions(): string[];
  getAvailableMotionGroups(): Record<string, number>;
  /** The catalog with the descriptions the `.iki` file declares. */
  getAvatarControlCatalog(): AvatarControlCatalog;
  /**
   * Frame `view` (centre and size in model units, +y up) instead of the
   * model's box, e.g. a full body whose raised arm leaves the box; no argument
   * restores the box. Kept across loads. Throws on a non-finite centre or a
   * non-positive size — before `initialize()`, that throw comes from
   * `initialize()`.
   */
  setView(view?: IkiView): void;
}

export function createIkiRenderer(options?: IkiRendererOptions): IkiRenderer {
  return new IkiRendererImpl(options);
}
