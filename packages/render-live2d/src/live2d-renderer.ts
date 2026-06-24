import {
  subscribeBrowserLifecycle,
  type Character,
  type GazeCoordinates,
  type Message,
  type Renderer,
} from "@charivo/core";
import { type MouseCoordinates, type MouseTrackable } from "@charivo/render";
import { Option, CubismFramework } from "@framework/live2dcubismframework";
import { CubismMatrix44 } from "@framework/math/cubismmatrix44";
import { CubismViewMatrix } from "@framework/math/cubismviewmatrix";

import { LAppModel } from "./cubism/lappmodel";
import { CubismModelHost } from "./cubism/model-host";
import * as LAppDefine from "./cubism/lappdefine";
import { LAppPal } from "./cubism/lapppal";
import { loadCubismCore } from "./utils/cubism-core";
import { playSafe } from "./utils/motion";
import { setupResponsiveResize, type ResizeTeardown } from "./utils/resize";
import { type Live2DRenderer, type Live2DRendererOptions } from "./renderer";

export class Live2DRendererImpl
  implements Renderer, MouseTrackable, Live2DRenderer
{
  private static cubismStarted = false;

  private canvas?: HTMLCanvasElement;
  private host?: CubismModelHost;
  private model?: LAppModel;
  private lastModelPath?: string;
  private teardownResize?: ResizeTeardown;
  private teardownBrowserLifecycle?: () => void;
  private animationFrameId?: number;
  private renderLoopPaused = false;
  private recoveryPending = false;
  private isRestoringContext = false;
  private deviceToScreen = new CubismMatrix44();
  private viewMatrix = new CubismViewMatrix();

  constructor(options?: Live2DRendererOptions) {
    this.canvas = options?.canvas;
  }

  async initialize(): Promise<void> {
    if (!this.canvas)
      throw new Error("Canvas element is required for Live2D rendering");

    await loadCubismCore();
    this.initializeCubism();

    this.host = new CubismModelHost(this.canvas);
    this.host.initialize();
    this.bindCanvasLifecycle();
    this.bindPageLifecycle();

    this.resizeCanvas();
    this.teardownResize = setupResponsiveResize(this.canvas, () =>
      this.resizeCanvas(),
    );

    this.startRenderLoop();
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!this.host) throw new Error("Live2D renderer is not initialized");

    this.lastModelPath = modelPath;
    this.model?.release();

    const model = new LAppModel();
    await model.loadAssets(modelPath, this.host);
    await model.waitUntilReady();
    this.model = model;
  }

  async render(_message: Message, _character?: Character): Promise<void> {
    // Stateless renderer - rendering is handled by RenderManager
    // This method is called by RenderManager after motion/expression control
  }

  /**
   * Set realtime lip sync mode (controlled by RenderManager)
   */
  setRealtimeLipSync(enabled: boolean): void {
    if (this.model?.isReady()) {
      this.model.setRealtimeLipSync(enabled);
    }
  }

  /**
   * Update realtime lip sync RMS (controlled by RenderManager)
   */
  updateRealtimeLipSyncRms(rms: number): void {
    if (this.model?.isReady()) {
      this.model.updateRealtimeLipSyncRms(rms);
    }
  }

  /**
   * Get available expressions from the loaded model
   */
  getAvailableExpressions(): string[] {
    if (!this.model?.isReady()) return [];
    return this.model.getAvailableExpressions();
  }

  /**
   * Get available motion groups from the loaded model
   */
  getAvailableMotionGroups(): Record<string, number> {
    if (!this.model?.isReady()) return {};
    return this.model.getAvailableMotionGroups();
  }

  /**
   * Play a specific expression by ID
   */
  playExpression(expressionId: string): void {
    if (!this.model?.isReady()) return;
    if (this.model.hasExpression(expressionId)) {
      this.model.setExpression(expressionId);
    }
  }

  /**
   * Play a specific motion by group and index
   */
  playMotionByGroup(group: string, index: number): void {
    if (!this.model?.isReady()) return;
    if (this.model.hasMotion(group, index)) {
      this.model.startMotion(group, index, LAppDefine.PriorityNormal);
    }
  }

  lookAt(coords: GazeCoordinates): void {
    if (!this.model?.isReady()) return;

    this.model.setDragging(clamp(coords.x, -1, 1), clamp(coords.y, -1, 1));
  }

  async destroy(): Promise<void> {
    this.unbindCanvasLifecycle();
    this.unbindPageLifecycle();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    this.model?.release();
    this.model = undefined;

    this.host?.dispose();
    this.host = undefined;

    this.teardownResize?.();
    this.teardownResize = undefined;
  }

  private initializeCubism(): void {
    if (!Live2DRendererImpl.cubismStarted) {
      const option = new Option();
      option.logFunction = (message: string) => LAppPal.printMessage(message);
      option.loggingLevel = LAppDefine.CubismLoggingLevel;
      CubismFramework.startUp(option);
      CubismFramework.initialize();
      Live2DRendererImpl.cubismStarted = true;
    }

    LAppPal.updateTime();
  }

  private startRenderLoop(): void {
    this.renderLoopPaused = false;
    const loop = () => {
      this.animationFrameId = requestAnimationFrame(loop);
      this.renderFrame();
    };

    loop();
  }

  private renderFrame(): void {
    if (!this.host || this.renderLoopPaused || this.recoveryPending) return;

    const gl = this.host.getGlManager().getGl();

    LAppPal.updateTime();

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (!this.model?.isReady()) return;

    const projection = new CubismMatrix44();
    const coreModel = this.model.getModel();
    const canvas = this.canvas!;

    if (coreModel) {
      if (coreModel.getCanvasWidth() > 1.0 && canvas.width < canvas.height) {
        this.model.getModelMatrix().setWidth(2.0);
        projection.scale(1.0, canvas.width / canvas.height);
      } else {
        projection.scale(canvas.height / canvas.width, 1.0);
      }
    }

    projection.multiplyByMatrix(this.viewMatrix);
    this.model.update();
    this.model.draw(projection);
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.host || this.recoveryPending) return;

    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect?.width ?? this.canvas.width));
    const height = Math.max(1, Math.floor(rect?.height ?? this.canvas.height));

    if (rect) {
      this.canvas.style.width = `${Math.max(1, Math.floor(rect.width))}px`;
      this.canvas.style.height = `${Math.max(1, Math.floor(rect.height))}px`;
    }

    this.host.resizeToDisplaySize(width, height);
    this.updateViewMatrices();
  }

  private updateViewMatrices(): void {
    if (!this.canvas) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const ratio = width / height;
    const left = -ratio;
    const right = ratio;
    const bottom = LAppDefine.ViewLogicalBottom;
    const top = LAppDefine.ViewLogicalTop;

    this.viewMatrix.setScreenRect(left, right, bottom, top);
    this.viewMatrix.scale(LAppDefine.ViewScale, LAppDefine.ViewScale);
    this.viewMatrix.setMaxScale(LAppDefine.ViewMaxScale);
    this.viewMatrix.setMinScale(LAppDefine.ViewMinScale);
    this.viewMatrix.setMaxScreenRect(
      LAppDefine.ViewLogicalMaxLeft,
      LAppDefine.ViewLogicalMaxRight,
      LAppDefine.ViewLogicalMaxBottom,
      LAppDefine.ViewLogicalMaxTop,
    );

    this.deviceToScreen.loadIdentity();
    if (width > height) {
      const screenW = Math.abs(right - left);
      this.deviceToScreen.scaleRelative(screenW / width, -screenW / width);
    } else {
      const screenH = Math.abs(top - bottom);
      this.deviceToScreen.scaleRelative(screenH / height, -screenH / height);
    }
    this.deviceToScreen.translateRelative(-width * 0.5, -height * 0.5);
  }

  updateViewWithMouse(coords: MouseCoordinates): void {
    if (!this.model?.isReady()) return;
    const { viewX, viewY } = this.toViewCoordinates(coords);
    this.model.setDragging(viewX, viewY);
  }

  handleMouseTap(coords: MouseCoordinates): void {
    if (!this.model?.isReady()) return;
    const { viewX, viewY } = this.toViewCoordinates(coords);
    const hitBody = this.model.hitTest(
      LAppDefine.HitAreaNameBody,
      viewX,
      viewY,
    );

    if (hitBody) {
      playSafe(this.model, LAppDefine.MotionGroupBody, 0, 1);
      playSafe(this.model, LAppDefine.MotionGroupTap, 0, 1);
    }
  }

  private toViewCoordinates(coords: MouseCoordinates): {
    viewX: number;
    viewY: number;
  } {
    if (!this.canvas) return { viewX: 0, viewY: 0 };

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const deviceX = (coords.clientX - rect.left) * dpr;
    const deviceY = (coords.clientY - rect.top) * dpr;

    const screenX = this.deviceToScreen.transformX(deviceX);
    const screenY = this.deviceToScreen.transformY(deviceY);

    return {
      viewX: this.viewMatrix.invertTransformX(screenX),
      viewY: this.viewMatrix.invertTransformY(screenY),
    };
  }

  private bindCanvasLifecycle(): void {
    this.canvas?.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas?.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
  }

  private unbindCanvasLifecycle(): void {
    this.canvas?.removeEventListener(
      "webglcontextlost",
      this.handleContextLost,
    );
    this.canvas?.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
  }

  private bindPageLifecycle(): void {
    if (this.teardownBrowserLifecycle) {
      return;
    }

    this.teardownBrowserLifecycle = subscribeBrowserLifecycle({
      onHidden: this.handleHidden,
      onPageHide: this.handlePageHide,
      onPageShow: this.handlePageShow,
      onVisible: this.handleVisible,
    });
  }

  private unbindPageLifecycle(): void {
    this.teardownBrowserLifecycle?.();
    this.teardownBrowserLifecycle = undefined;
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.recoveryPending = true;
    this.pauseRenderLoop();
  };

  private readonly handleContextRestored = (): void => {
    void this.restoreAfterContextLoss();
  };

  private readonly handleHidden = (): void => {
    this.pauseRenderLoop();
  };

  private readonly handleVisible = (): void => {
    this.resumeRenderLoop();
  };

  private readonly handlePageHide = (): void => {
    this.pauseRenderLoop();
  };

  private readonly handlePageShow = (): void => {
    this.resumeRenderLoop();
  };

  private pauseRenderLoop(): void {
    this.renderLoopPaused = true;
  }

  private resumeRenderLoop(): void {
    if (this.recoveryPending) {
      return;
    }

    this.renderLoopPaused = false;
  }

  private async restoreAfterContextLoss(): Promise<void> {
    if (!this.canvas || this.isRestoringContext) {
      return;
    }

    this.isRestoringContext = true;
    this.recoveryPending = true;

    try {
      this.model?.release();
      this.model = undefined;
      this.host?.dispose();

      this.host = new CubismModelHost(this.canvas);
      this.host.initialize();
      this.resizeCanvas();

      if (this.lastModelPath) {
        const model = new LAppModel();
        await model.loadAssets(this.lastModelPath, this.host);
        await model.waitUntilReady();
        this.model = model;
      }

      this.updateViewMatrices();
      this.recoveryPending = false;
      this.resumeRenderLoop();
    } finally {
      this.isRestoringContext = false;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
