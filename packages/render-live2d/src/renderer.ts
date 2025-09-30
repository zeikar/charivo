import { Renderer, Message, Character } from "@charivo/core";
import { Option, CubismFramework } from "@framework/live2dcubismframework";
import { CubismMatrix44 } from "@framework/math/cubismmatrix44";
import { CubismViewMatrix } from "@framework/math/cubismviewmatrix";

import { LAppModel } from "./cubism/lappmodel";
import { CubismModelHost } from "./cubism/model-host";
import * as LAppDefine from "./cubism/lappdefine";
import { LAppPal } from "./cubism/lapppal";
import {
  inferMotionFromMessage,
  playMotion,
  animateExpression,
  playSafe,
} from "./utils/motion";
import { setupResponsiveResize, type ResizeTeardown } from "./utils/resize";
import { RealTimeLipSync } from "./utils/lipsync";

export class Live2DRenderer implements Renderer {
  private static cubismStarted = false;

  private canvas?: HTMLCanvasElement;
  private host?: CubismModelHost;
  private model?: LAppModel;
  private messageCallback?: (message: Message, character?: Character) => void;
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
  private draggingPointerId?: number;
  private lipSync = new RealTimeLipSync();

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  setMessageCallback(
    callback: (message: Message, character?: Character) => void,
  ): void {
    this.messageCallback = callback;
  }

  setEventBus(eventBus: {
    on: (event: string, callback: (...args: any[]) => void) => void;
    emit: (event: string, data: any) => void;
  }): void {
    console.log(
      "🎯 Live2DRenderer: Event bus connected - setting up listeners",
    );

    // Listen for TTS audio events
    eventBus.on(
      "tts:audio:start",
      (data: { audioElement: HTMLAudioElement; characterId?: string }) => {
        console.log(
          "🎵 Live2DRenderer: ✅ RECEIVED tts:audio:start event",
          data,
        );
        this.startRealtimeLipSync(data.audioElement, data.characterId);
      },
    );

    eventBus.on("tts:audio:end", (data: { characterId?: string }) => {
      console.log("🔇 Live2DRenderer: ✅ RECEIVED tts:audio:end event", data);
      this.stopRealtimeLipSync();
    });

    eventBus.on(
      "tts:lipsync:update",
      (data: { rms: number; characterId?: string }) => {
        if (this.model?.isReady()) {
          this.model.setRealtimeLipSync(true);
          this.model.updateRealtimeLipSyncRms(data.rms);
        }
      },
    );

    // Test all events are properly registered
    console.log("🎯 Live2DRenderer: All event listeners registered");

    // Emit lip sync updates for external listeners
    this.lipSync.cleanup(); // Clean up any existing connections
  }

  private startRealtimeLipSync(
    audioElement: HTMLAudioElement,
    characterId?: string,
  ): void {
    console.log("🎤 Live2DRenderer: Starting realtime lip sync", {
      modelReady: this.model?.isReady(),
      audioElement: audioElement?.tagName,
      characterId,
    });

    if (!this.model?.isReady()) {
      console.warn("⚠️ Live2DRenderer: Model not ready for lip sync");
      return;
    }

    this.model.setRealtimeLipSync(true);
    console.log("✅ Live2DRenderer: Model set to realtime lip sync mode");

    this.lipSync.connectToAudio(audioElement, (rms: number) => {
      // Only log significant RMS changes to avoid spam
      if (rms > 0.1) {
        console.log(`📊 Live2DRenderer: RMS update: ${rms.toFixed(3)}`);
      }
      this.model?.updateRealtimeLipSyncRms(rms);
    });
  }

  private stopRealtimeLipSync(): void {
    console.log("🛑 Live2DRenderer: Stopping realtime lip sync");

    if (!this.model?.isReady()) {
      console.warn("⚠️ Live2DRenderer: Model not ready during lip sync stop");
      return;
    }

    this.model.setRealtimeLipSync(false);
    this.lipSync.stop();
    console.log("✅ Live2DRenderer: Lip sync stopped");
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
    console.log("👤 Character set:", character.name);
  }

  async render(message: Message, character?: Character): Promise<void> {
    const timestamp = message.timestamp.toLocaleTimeString();
    if (message.type === "user") {
      console.log(`👤 [${timestamp}] User: ${message.content}`);
    } else if (message.type === "character" && character) {
      console.log(`🎭 [${timestamp}] ${character.name}: ${message.content}`);
      if (!this.model?.isReady()) return;
      const motionType = inferMotionFromMessage(message.content);
      playMotion(this.model, motionType);
      animateExpression(this.model, motionType);
    } else {
      console.log(`ℹ️ [${timestamp}] System: ${message.content}`);
    }
    this.messageCallback?.(message, character);
  }

  async destroy(): Promise<void> {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    if (this.pointerHandlers && this.canvas) {
      this.canvas.removeEventListener("pointerdown", this.pointerHandlers.down);
      this.canvas.removeEventListener("pointermove", this.pointerHandlers.move);
      this.canvas.removeEventListener("pointerup", this.pointerHandlers.up);
      this.canvas.removeEventListener(
        "pointercancel",
        this.pointerHandlers.cancel,
      );
      this.pointerHandlers = undefined;
    }

    this.model?.release();
    this.model = undefined;

    this.host?.dispose();
    this.host = undefined;

    this.lipSync.cleanup();

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
      this.draggingPointerId = event.pointerId;
      this.canvas?.setPointerCapture(event.pointerId);
      const { viewX, viewY } = this.toViewCoordinates(event);
      this.model.setDragging(viewX, viewY);
      this.handleTap(viewX, viewY);
    };

    const move = (event: PointerEvent) => {
      if (!this.model?.isReady()) return;
      if (this.draggingPointerId !== event.pointerId) return;
      const { viewX, viewY } = this.toViewCoordinates(event);
      this.model.setDragging(viewX, viewY);
    };

    const end = (event: PointerEvent) => {
      if (!this.model?.isReady()) return;
      if (this.draggingPointerId !== event.pointerId) return;
      this.model.setDragging(0, 0);
      this.draggingPointerId = undefined;
      this.canvas?.releasePointerCapture(event.pointerId);
    };

    const cancel = (event: PointerEvent) => {
      if (this.draggingPointerId !== event.pointerId) return;
      this.model?.setDragging(0, 0);
      this.draggingPointerId = undefined;
    };

    this.canvas.addEventListener("pointerdown", down, { passive: true });
    this.canvas.addEventListener("pointermove", move, { passive: true });
    this.canvas.addEventListener("pointerup", end, { passive: true });
    this.canvas.addEventListener("pointercancel", cancel, { passive: true });

    this.pointerHandlers = { down, move, up: end, cancel };
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
  canvas?: HTMLCanvasElement,
): Live2DRenderer {
  return new Live2DRenderer(canvas);
}
