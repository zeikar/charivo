/**
 * Thin wrapper that provides the bridge between Charivo's renderer and the
 * Live2D Cubism sample model implementation. It handles WebGL lifecycle,
 * texture creation, and viewport resizing for a single canvas.
 */

import { LAppGlManager } from "./lappglmanager";
import { LAppTextureManager } from "./lapptexturemanager";

export class CubismModelHost {
  private readonly glManager = new LAppGlManager();
  private readonly textureManager = new LAppTextureManager();
  private frameBuffer: WebGLFramebuffer | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  public initialize(): void {
    if (!this.glManager.initialize(this.canvas)) {
      throw new Error("Live2D: Failed to initialize WebGL context.");
    }

    this.textureManager.setGlManager(this.glManager);

    const gl = this.glManager.getGl();
    this.frameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  public resizeToDisplaySize(width: number, height: number): void {
    const gl = this.glManager.getGl();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));

    if (
      this.canvas.width !== pixelWidth ||
      this.canvas.height !== pixelHeight
    ) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getGlManager(): LAppGlManager {
    return this.glManager;
  }

  public getTextureManager(): LAppTextureManager {
    return this.textureManager;
  }

  public getFrameBuffer(): WebGLFramebuffer | null {
    return this.frameBuffer;
  }

  public dispose(): void {
    this.textureManager.release();
    this.glManager.release();
    this.frameBuffer = null;
  }
}
