import { type GazeCoordinates, type Renderer } from "@charivo/core";
import { type GazeOrigin, type MouseTrackable } from "@charivo/render";

import { Live2DRendererImpl } from "./live2d-renderer";

export interface Live2DRendererOptions {
  canvas?: HTMLCanvasElement;
}

export interface Live2DRenderer extends Renderer, MouseTrackable {
  loadModel(modelPath: string): Promise<void>;
  playExpression(expressionId: string): void;
  stopExpression(): void;
  playMotionByGroup(
    group: string,
    index: number,
    options?: { muteSound?: boolean },
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
