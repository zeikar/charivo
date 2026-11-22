import type {
  AvatarControlCatalog,
  GazeCoordinates,
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
  playExpression(expressionId: string): void;
  stopExpression(): void;
  /** `options.muteSound` is accepted for the `Renderer` contract and ignored: Iki motion clips carry no audio. */
  playMotionByGroup(
    group: string,
    index: number,
    options?: { muteSound?: boolean },
  ): void;
  lookAt(coords: GazeCoordinates): void;
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
