import { Renderer, Message, Character } from "@charivo/core";
import {
  type MouseCoordinates,
  type MouseTrackable,
} from "@charivo/render-core";
import { Option, CubismFramework } from "@framework/live2dcubismframework";
import { CubismMatrix44 } from "@framework/math/cubismmatrix44";
import { CubismViewMatrix } from "@framework/math/cubismviewmatrix";

import { LAppModel } from "./cubism/lappmodel";
import { CubismModelHost } from "./cubism/model-host";
import * as LAppDefine from "./cubism/lappdefine";
import { LAppPal } from "./cubism/lapppal";
import { playSafe } from "./utils/motion";
import { setupResponsiveResize, type ResizeTeardown } from "./utils/resize";

export interface Live2DRendererOptions {
  canvas?: HTMLCanvasElement;
}

export class Live2DRenderer implements Renderer, MouseTrackable {
  private static cubismStarted = false;

  private canvas?: HTMLCanvasElement;
  private host?: CubismModelHost;
  private model?: LAppModel;
  private teardownResize?: ResizeTeardown;
  private animationFrameId?: number;
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

    this.resizeCanvas();
    this.teardownResize = setupResponsiveResize(this.canvas, () =>
      this.resizeCanvas(),
    );

    this.startRenderLoop();
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!this.host) throw new Error("Live2D renderer is not initialized");

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

  async destroy(): Promise<void> {
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
}

export function createLive2DRenderer(
  options?: Live2DRendererOptions,
): Live2DRenderer {
  return new Live2DRenderer(options);
}

async function loadCubismCore(): Promise<void> {
  if (typeof window === "undefined") return;
  if (isCubismCoreReady()) return;

  // Import as raw text (text loader in tsup) so esbuild doesn't treat it as an
  // ESM module. Then inject as a classic <script> so var declarations become
  // window-scoped globals (required by CubismFramework).
  const { default: coreScript } = await import(
    "../CubismSdkForWeb-5-r.4/Core/live2dcubismcore.min.js"
  );
  const script = document.createElement("script");
  script.text = coreScript;
  document.head.appendChild(script);

  // The Emscripten WASM runtime initializes asynchronously even when the script
  // runs synchronously. Poll until Live2DCubismCore.Version.csmGetVersion()
  // succeeds, which confirms all WASM exports are linked and ready.
  await new Promise<void>((resolve) => {
    const check = () => {
      if (isCubismCoreReady()) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}

function isCubismCoreReady(): boolean {
  try {
    Live2DCubismCore.Version.csmGetVersion();
    return true;
  } catch {
    return false;
  }
}
