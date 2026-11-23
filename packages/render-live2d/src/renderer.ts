import {
  type GazeCoordinates,
  type MotionPriority,
  type Renderer,
} from "@charivo/core";
import { type GazeOrigin, type MouseTrackable } from "@charivo/render";

import { Live2DRendererImpl } from "./live2d-renderer";

export interface Live2DRendererOptions {
  canvas?: HTMLCanvasElement;
}

export interface Live2DRenderer extends Renderer, MouseTrackable {
  loadModel(modelPath: string): Promise<void>;
  playExpression(expressionId: string): void;
  stopExpression(): void;
  /**
   * `options.priority` maps onto Cubism's own motion priorities: `"force"`
   * cuts any motion, `"normal"` (the default) is declined while a normal or
   * forced motion runs, `"idle"` starts only when no motion, the idle loop
   * included, is playing.
   */
  playMotionByGroup(
    group: string,
    index: number,
    options?: { muteSound?: boolean; priority?: MotionPriority },
  ): void;
  lookAt(coords: GazeCoordinates): void;
  setGazeOrigin(origin?: GazeOrigin): void;
  getAvailableExpressions(): string[];
  getAvailableMotionGroups(): Record<string, number>;
}

export function createLive2DRenderer(
  options?: Live2DRendererOptions,
): Live2DRenderer {
  return new Live2DRendererImpl(options);
}
