import {
  subscribeBrowserLifecycle,
  type Character,
  type GazeCoordinates,
  type Message,
  type MotionPriority,
  type Renderer,
} from "@charivo/core";
import {
  type GazeOrigin,
  type MouseCoordinates,
  type MouseTrackable,
} from "@charivo/render";
import { Option, CubismFramework } from "@framework/live2dcubismframework";
import { CubismMatrix44 } from "@framework/math/cubismmatrix44";
import { CubismViewMatrix } from "@framework/math/cubismviewmatrix";
import { InvalidMotionQueueEntryHandleValue } from "@framework/motion/cubismmotionqueuemanager";

import { LAppModel } from "./cubism/lappmodel";
import { CubismModelHost } from "./cubism/model-host";
import * as LAppDefine from "./cubism/lappdefine";
import { LAppPal } from "./cubism/lapppal";
import { loadCubismCore } from "./utils/cubism-core";
import { playSafe } from "./utils/motion";
import { setupResponsiveResize, type ResizeTeardown } from "./utils/resize";
import { type Live2DRenderer, type Live2DRendererOptions } from "./renderer";

const CUBISM_MOTION_PRIORITY: Record<MotionPriority, number> = {
  idle: LAppDefine.PriorityIdle,
  normal: LAppDefine.PriorityNormal,
  force: LAppDefine.PriorityForce,
};

export class Live2DRendererImpl
  implements Renderer, MouseTrackable, Live2DRenderer
{
  private static cubismStarted = false;

  private canvas?: HTMLCanvasElement;
  private host?: CubismModelHost;
  private model?: LAppModel;
  private lastModelPath?: string;
  /** Counts model loads, so one a later load overtook can tell. */
  private loadCount = 0;
  /** Where the mouse gaze is measured from; unset = the view's centre. */
  private gazeOrigin?: GazeOrigin;
  /**
   * What the face and gaze were last told, kept so a rebuilt model (WebGL
   * context restore) can be given back what a held claim put on the old one.
   * Updated even while no model exists, so a clear during recovery is honored.
   */
  private appliedExpression?: string;
  private appliedGaze?: GazeCoordinates;
  /** Recorded like the above: the rebuilt model starts with lip sync off. */
  private appliedRealtimeLipSync = false;
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
    this.appliedExpression = undefined;
    this.appliedGaze = undefined;
    this.model?.release();

    const model = await this.loadLatest(modelPath, this.host);
    if (model) this.model = model;
  }

  /**
   * Load a model for `host`. Resolves undefined, with the model released, when
   * it is no longer the one wanted by the time it is ready: a later load began
   * (the latest call wins, however late this one lands), or the host it was
   * built for is gone (destroy(), or a context restore).
   */
  private async loadLatest(
    modelPath: string,
    host: CubismModelHost,
  ): Promise<LAppModel | undefined> {
    const load = ++this.loadCount;
    const model = new LAppModel();
    await model.loadAssets(modelPath, host);
    await model.waitUntilReady();
    if (load !== this.loadCount || this.host !== host) {
      model.release();
      return undefined;
    }
    return model;
  }

  async render(_message: Message, _character?: Character): Promise<void> {
    // Stateless renderer - rendering is handled by RenderManager
    // This method is called by RenderManager after motion/expression control
  }

  /**
   * Set realtime lip sync mode (controlled by RenderManager)
   */
  setRealtimeLipSync(enabled: boolean): void {
    this.appliedRealtimeLipSync = enabled;
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
    if (!this.model?.isReady()) {
      this.appliedExpression = expressionId;
      return;
    }
    if (this.model.hasExpression(expressionId)) {
      this.appliedExpression = expressionId;
      this.model.setExpression(expressionId);
    }
  }

  /**
   * Drop the active expression and return to the model's base face
   */
  stopExpression(): void {
    this.appliedExpression = undefined;
    if (!this.model?.isReady()) return;
    this.model.clearExpression();
  }

  /**
   * Play a specific motion by group and index
   */
  playMotionByGroup(
    group: string,
    index: number,
    options?: { muteSound?: boolean; priority?: MotionPriority },
  ): boolean {
    if (!this.model?.isReady()) return false;
    if (!this.model.hasMotion(group, index)) return false;
    // Whether the motion may start is decided by LAppModel.startMotion,
    // against the motion Cubism is actually running.
    const priority = CUBISM_MOTION_PRIORITY[options?.priority ?? "normal"];
    // An unmuted call keeps the exact three-argument shape it has always
    // had, so nothing changes for callers that never pass options.
    const handle = options?.muteSound
      ? this.model.startMotion(group, index, priority, undefined, undefined, {
          muteSound: true,
        })
      : this.model.startMotion(group, index, priority);
    return handle !== InvalidMotionQueueEntryHandleValue;
  }

  lookAt(coords: GazeCoordinates): void {
    this.appliedGaze = coords;
    if (!this.model?.isReady()) return;

    this.model.setDragging(clamp(coords.x, -1, 1), clamp(coords.y, -1, 1));
  }

  /** Cubism has no stored gaze target to drop; the neutral drag is centre. */
  clearGaze(): void {
    this.appliedGaze = undefined;
    if (!this.model?.isReady()) return;

    this.model.setDragging(0, 0);
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
      if (this.fitsModelToWidth(coreModel)) {
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
    // The pointer now owns the gaze, so an earlier lookAt() target is stale.
    this.appliedGaze = undefined;
    if (!this.model?.isReady()) return;
    const { viewX, viewY } = this.toViewCoordinates(coords);
    const origin = this.gazeOriginInView();
    this.model.setDragging(viewX - origin.x, viewY - origin.y);
  }

  /**
   * `MouseTrackable.setGazeOrigin`: measure the mouse drag from a point of the
   * model's canvas (fractions, top-left to bottom-right) instead of the view's
   * centre. Throws on a non-finite `x` or `y`: kept, it would hand the model a
   * NaN drag on every pointer move.
   */
  setGazeOrigin(origin?: GazeOrigin): void {
    if (origin && !(Number.isFinite(origin.x) && Number.isFinite(origin.y))) {
      throw new Error(
        `Live2D: setGazeOrigin() needs a finite x and y, got ${origin.x}, ${origin.y}`,
      );
    }
    this.gazeOrigin = origin;
  }

  /**
   * Where the gaze origin sits in view coordinates, the space a drag and a
   * hit test are given in and the model matrix maps the model into: the
   * fractions become model units (origin at the canvas's centre, +y up) and
   * go through that matrix, read at each call because the frame loop refits
   * it to the canvas. The view's centre when no origin is set.
   */
  private gazeOriginInView(): { x: number; y: number } {
    const origin = this.gazeOrigin;
    const coreModel = this.model?.getModel();
    if (!origin || !this.model || !this.canvas || !coreModel) {
      return { x: 0, y: 0 };
    }
    const modelMatrix = this.model.getModelMatrix();
    // In the width fit the frame loop draws with the canvas's width as the
    // unit, while a pointer's view coordinates keep its height: they come out
    // width / height times the drawn model's (the Cubism sample's mismatch,
    // which the plain drag and the hit test have always lived with). The
    // origin takes the same factor, so it lands where a pointer on it does.
    const scale = this.fitsModelToWidth(coreModel)
      ? this.canvas.width / this.canvas.height
      : 1;
    return {
      x:
        scale *
        modelMatrix.transformX((origin.x - 0.5) * coreModel.getCanvasWidth()),
      y:
        scale *
        modelMatrix.transformY((0.5 - origin.y) * coreModel.getCanvasHeight()),
    };
  }

  /**
   * True when the frame loop fits the model to the canvas's width rather than
   * its height: a model wider than one unit on a portrait canvas.
   */
  private fitsModelToWidth(coreModel: { getCanvasWidth(): number }): boolean {
    const canvas = this.canvas!;
    return coreModel.getCanvasWidth() > 1.0 && canvas.width < canvas.height;
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
        const model = await this.loadLatest(this.lastModelPath, this.host);
        if (model) {
          this.model = model;
          // Before the expression: with lip sync off, an expression restored
          // mid-speech would keep the mouth open for the rest of the line.
          if (this.appliedRealtimeLipSync) model.setRealtimeLipSync(true);
          // The rebuilt model starts neutral; give it back what was applied.
          if (this.appliedExpression)
            this.playExpression(this.appliedExpression);
          if (this.appliedGaze) this.lookAt(this.appliedGaze);
        }
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
