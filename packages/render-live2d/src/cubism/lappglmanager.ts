/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

/**
 * Minimal WebGL manager used by the Live2D renderer.
 */
export class LAppGlManager {
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

  public initialize(canvas: HTMLCanvasElement): boolean {
    const context =
      canvas.getContext("webgl2") ?? canvas.getContext("webgl") ?? null;

    if (!context) {
      console.error("Live2D: Unable to acquire WebGL context.");
      return false;
    }

    this.gl = context;
    return true;
  }

  public release(): void {
    this.gl = null;
  }

  public getGl(): WebGLRenderingContext | WebGL2RenderingContext {
    if (!this.gl) {
      throw new Error("Live2D: WebGL context has not been initialized.");
    }
    return this.gl;
  }
}
