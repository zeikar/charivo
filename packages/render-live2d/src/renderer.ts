import { Renderer, Message, Character, MotionType } from "@charivo/core";
import { Option, CubismFramework } from "@framework/live2dcubismframework";
import { CubismMatrix44 } from "@framework/math/cubismmatrix44";
import { CubismViewMatrix } from "@framework/math/cubismviewmatrix";

import { LAppModel } from "./cubism/lappmodel";
import { CubismModelHost } from "./cubism/model-host";
import * as LAppDefine from "./cubism/lappdefine";
import { LAppPal } from "./cubism/lapppal";
import { playSafe } from "./utils/motion";
import { setupResponsiveResize, type ResizeTeardown } from "./utils/resize";

export type MouseTrackingMode = "canvas" | "document";

export interface Live2DRendererOptions {
  canvas?: HTMLCanvasElement;
  mouseTracking?: MouseTrackingMode;
}

export class Live2DRenderer implements Renderer {
  private static cubismStarted = false;

  private canvas?: HTMLCanvasElement;
  private host?: CubismModelHost;
  private model?: LAppModel;
  private teardownResize?: ResizeTeardown;
  private animationFrameId?: number;
  private pointerHandlers?: {
    down: (event: PointerEvent) => void;
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
  };
  private deviceToScreen = new CubismMatrix44();
  private viewMatrix = new CubismViewMatrix();
  private mouseTracking: MouseTrackingMode;

  constructor(options?: Live2DRendererOptions) {
    this.canvas = options?.canvas;
    this.mouseTracking = options?.mouseTracking ?? "canvas";
  }

  async initialize(): Promise<void> {
    if (!this.canvas)
      throw new Error("Canvas element is required for Live2D rendering");

    this.initializeCubism();

    this.host = new CubismModelHost(this.canvas);
    this.host.initialize();

    this.resizeCanvas();
    this.teardownResize = setupResponsiveResize(this.canvas, () =>
      this.resizeCanvas(),
    );

    this.attachPointerEvents();
    this.startRenderLoop();
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!this.host) throw new Error("Live2D renderer is not initialized");

    if (typeof window !== "undefined") {
      const core = (window as unknown as { Live2DCubismCore?: unknown })
        .Live2DCubismCore;
      if (!core) {
        console.warn(
          "⚠️ Live2DCubismCore not found. Include live2dcubismcore.min.js on the page before initializing the renderer.",
        );
      }
    }

    this.model?.release();

    const model = new LAppModel();
    await model.loadAssets(modelPath, this.host);
    await model.waitUntilReady();
    this.model = model;
  }

  setCharacter(character: Character): void {
    console.log("👤 Live2DRenderer: Character set:", character.name);
  }

  async render(message: Message, character?: Character): Promise<void> {
    // Stateless renderer - just logs, no motion control
    // Motion control is handled by RenderManager
    const timestamp = message.timestamp.toLocaleTimeString();
    if (message.type === "user") {
      console.log(`👤 [${timestamp}] User: ${message.content}`);
    } else if (message.type === "character" && character) {
      console.log(`🎭 [${timestamp}] ${character.name}: ${message.content}`);
    } else {
      console.log(`ℹ️ [${timestamp}] System: ${message.content}`);
    }
  }

  /**
   * Play motion (controlled by RenderManager)
   */
  playMotion(motionType: MotionType): void {
    if (!this.model?.isReady()) return;

    switch (motionType) {
      case "greeting":
        playSafe(
          this.model,
          LAppDefine.MotionGroupBody,
          0,
          LAppDefine.PriorityNormal,
        );
        playSafe(
          this.model,
          LAppDefine.MotionGroupTap,
          0,
          LAppDefine.PriorityNormal,
        );
        break;
      case "happy":
        playSafe(
          this.model,
          LAppDefine.MotionGroupTapBody,
          0,
          LAppDefine.PriorityNormal,
        );
        break;
      case "thinking":
        playSafe(
          this.model,
          LAppDefine.MotionGroupIdle,
          1,
          LAppDefine.PriorityNormal,
        );
        break;
      default:
        playSafe(
          this.model,
          LAppDefine.MotionGroupIdle,
          0,
          LAppDefine.PriorityIdle,
        );
        break;
    }
  }

  /**
   * Animate expression (controlled by RenderManager)
   */
  animateExpression(motionType: MotionType): void {
    if (!this.model?.isReady()) return;

    const expressionId = this.chooseExpression(motionType);
    if (!this.model.hasExpression(expressionId)) return;

    try {
      this.model.setExpression(expressionId);
    } catch {
      // expression may not be available on all models
    }
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

  private chooseExpression(motionType: MotionType): string {
    switch (motionType) {
      case "greeting":
      case "happy":
        return "smile";
      case "thinking":
        return "surprised";
      default:
        return "normal";
    }
  }

  async destroy(): Promise<void> {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    if (this.pointerHandlers) {
      const eventTarget =
        this.mouseTracking === "document" ? document : this.canvas;
      eventTarget?.removeEventListener(
        "pointerdown",
        this.pointerHandlers.down,
      );
      eventTarget?.removeEventListener(
        "pointermove",
        this.pointerHandlers.move,
      );
      eventTarget?.removeEventListener("pointerup", this.pointerHandlers.up);
      eventTarget?.removeEventListener(
        "pointercancel",
        this.pointerHandlers.cancel,
      );
      this.pointerHandlers = undefined;
    }

    this.model?.release();
    this.model = undefined;

    this.host?.dispose();
    this.host = undefined;

    this.teardownResize?.();
    this.teardownResize = undefined;
  }

  private initializeCubism(): void {
    if (!Live2DRenderer.cubismStarted) {
      const option = new Option();
      option.logFunction = (message: string) => LAppPal.printMessage(message);
      option.loggingLevel = LAppDefine.CubismLoggingLevel;
      CubismFramework.startUp(option);
      CubismFramework.initialize();
      Live2DRenderer.cubismStarted = true;
    }

    LAppPal.updateTime();
  }

  private startRenderLoop(): void {
    const loop = () => {
      this.animationFrameId = requestAnimationFrame(loop);
      this.renderFrame();
    };

    loop();
  }

  private renderFrame(): void {
    if (!this.host) return;

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
    if (!this.canvas || !this.host) return;

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

  private attachPointerEvents(): void {
    if (!this.canvas) return;

    const down = (event: PointerEvent) => {
      if (!this.model?.isReady()) return;
      const rect = this.canvas?.getBoundingClientRect();
      if (!rect) return;
      const isOnCanvas =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (isOnCanvas) {
        const { viewX, viewY } = this.toViewCoordinates(event);
        this.handleTap(viewX, viewY);
      }
    };

    const move = (event: PointerEvent) => {
      if (!this.model?.isReady()) return;
      const { viewX, viewY } = this.toViewCoordinates(event);
      this.model.setDragging(viewX, viewY);
    };

    // Choose event target based on tracking mode
    const eventTarget =
      this.mouseTracking === "document" ? document : this.canvas;

    eventTarget.addEventListener("pointerdown", down, { passive: true });
    eventTarget.addEventListener("pointermove", move, { passive: true });

    this.pointerHandlers = { down, move, up: down, cancel: down };
  }

  private handleTap(viewX: number, viewY: number): void {
    if (!this.model?.isReady()) return;

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

  private toViewCoordinates(event: PointerEvent): {
    viewX: number;
    viewY: number;
  } {
    if (!this.canvas) return { viewX: 0, viewY: 0 };

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const deviceX = (event.clientX - rect.left) * dpr;
    const deviceY = (event.clientY - rect.top) * dpr;

    const screenX = this.deviceToScreen.transformX(deviceX);
    const screenY = this.deviceToScreen.transformY(deviceY);

    return {
      viewX: this.viewMatrix.invertTransformX(screenX),
      viewY: this.viewMatrix.invertTransformY(screenY),
    };
  }
}

export function createLive2DRenderer(
  options?: Live2DRendererOptions,
): Live2DRenderer {
  return new Live2DRenderer(options);
}
