import { type GazeCoordinates, type Renderer } from "@charivo/core";
import { type MouseTrackable } from "@charivo/render";

import { Live2DRendererImpl } from "./live2d-renderer";

export interface Live2DRendererOptions {
  canvas?: HTMLCanvasElement;
}

export interface Live2DRenderer extends Renderer, MouseTrackable {
  playExpression(expressionId: string): void;
  playMotionByGroup(group: string, index: number): void;
  lookAt(coords: GazeCoordinates): void;
  getAvailableExpressions(): string[];
  getAvailableMotionGroups(): Record<string, number>;
}

export function createLive2DRenderer(
  options?: Live2DRendererOptions,
): Live2DRenderer {
  return new Live2DRendererImpl(options);
}
