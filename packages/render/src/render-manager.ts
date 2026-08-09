import {
  type Character,
  type EventMap,
  type GazeCoordinates,
  type Message,
  type MotionSelection,
  type Renderer,
  type RenderManager as IRenderManager,
  type CharivoEventBus,
} from "@charivo/core";
import {
  setupMouseTracking,
  type MouseTrackable,
  type MouseTrackingCleanup,
  type MouseTrackingMode,
} from "./mouse-tracking";

const GAZE_MOUSE_SUSPEND_MS = 1_200;
const LOCAL_GAZE_SUSPEND_MS = 700;
const EXPRESSION_DEBOUNCE_MS = 300;
const MOTION_DEBOUNCE_MS = 1_000;
// Covers the spoken reply that set the expression (~15-20 words at typical
// TTS rate). Internal constant, no public knob by design.
const EXPRESSION_HOLD_MS = 8_000;

/**
 * Render Manager - Class responsible for managing the state of a rendering session
 *
 * Responsibilities:
 * - Renderer management and wrapping
 * - Event bus connection and event handling
 * - Lip-sync handling and coordination
 * - Motion and expression control
 * - Mouse tracking management
 * - Character configuration management
 * - Message rendering coordination
 *
 * RenderManager can accept any Renderer and
 * optionally uses the features the renderer supports (motion, lipsync, mouse tracking, etc.).
 */
export interface RenderManagerOptions {
  canvas?: HTMLCanvasElement;
  mouseTracking?: MouseTrackingMode;
}

export class RenderManager implements IRenderManager {
  private readonly renderer: Renderer;
  private character: Character | null = null;
  private messageCallback?: (message: Message, character?: Character) => void;
  private cleanupMouseTracking?: MouseTrackingCleanup;
  private resumeMouseTrackingTimer?: ReturnType<typeof setTimeout>;
  private expressionReleaseTimer?: ReturnType<typeof setTimeout>;
  private mouseTrackingSuspendedUntil = 0;
  private localGazeSuspendUntil = 0;
  private lastExpression?: { expressionId: string; at: number };
  private lastMotion?: { group: string; index: number; at: number };
  private eventBus?: CharivoEventBus;

  // Stable handler references so they can be removed by reference in disconnect()
  private readonly handleTtsAudioStart = (
    _data: EventMap["tts:audio:start"],
  ): void => {
    this.renderer.setRealtimeLipSync?.(true);
  };

  private readonly handleTtsAudioEnd = (
    _data: EventMap["tts:audio:end"],
  ): void => {
    this.deactivateRealtimeLipSync();
  };

  private readonly handleTtsLipsyncUpdate = (
    data: EventMap["tts:lipsync:update"],
  ): void => {
    this.updateLipSync(data.rms);
  };

  private readonly handleAvatarExpression = (
    data: EventMap["avatar:expression"],
  ): void => {
    this.applyExpression(data.expressionId);
  };

  private readonly handleAvatarMotion = (
    data: EventMap["avatar:motion"],
  ): void => {
    this.applyMotion({ group: data.group, index: data.index });
  };

  private readonly handleAvatarGaze = (data: EventMap["avatar:gaze"]): void => {
    this.applyGaze(data);
  };

  constructor(
    renderer: Renderer,
    private options?: RenderManagerOptions,
  ) {
    this.renderer = renderer;
  }

  /**
   * Connect the event bus
   */
  setEventBus(eventBus: CharivoEventBus): void {
    // Defensive self-clear: avoid double-registering if called again
    if (this.eventBus) {
      this.disconnect();
    }

    this.eventBus = eventBus;
    eventBus.on("tts:audio:start", this.handleTtsAudioStart);
    eventBus.on("tts:audio:end", this.handleTtsAudioEnd);
    eventBus.on("tts:lipsync:update", this.handleTtsLipsyncUpdate);
    eventBus.on("avatar:expression", this.handleAvatarExpression);
    eventBus.on("avatar:motion", this.handleAvatarMotion);
    eventBus.on("avatar:gaze", this.handleAvatarGaze);
  }

  /**
   * Remove the event bus listeners. Does nothing if no bus is connected, and is safe to call multiple times.
   */
  disconnect(): void {
    if (!this.eventBus) {
      return;
    }

    // Deactivate lip-sync before removing listeners so the renderer cannot
    // be left with the mouth open after the bus is cleared.
    this.deactivateRealtimeLipSync();

    this.eventBus.off("tts:audio:start", this.handleTtsAudioStart);
    this.eventBus.off("tts:audio:end", this.handleTtsAudioEnd);
    this.eventBus.off("tts:lipsync:update", this.handleTtsLipsyncUpdate);
    this.eventBus.off("avatar:expression", this.handleAvatarExpression);
    this.eventBus.off("avatar:motion", this.handleAvatarMotion);
    this.eventBus.off("avatar:gaze", this.handleAvatarGaze);
    this.eventBus = undefined;
  }

  /**
   * Set the message callback
   */
  setMessageCallback(
    callback: (message: Message, character?: Character) => void,
  ): void {
    this.messageCallback = callback;
  }

  /**
   * Set the character
   */
  setCharacter(character: Character): void {
    this.character = character;
  }

  /**
   * Initialize the renderer
   */
  async initialize(): Promise<void> {
    await this.renderer.initialize();

    if (this.isMouseTrackable(this.renderer) && this.options?.canvas) {
      const mouseTrackableRenderer = this.renderer;
      this.cleanupMouseTracking = setupMouseTracking({
        canvas: this.options.canvas,
        mode: this.options.mouseTracking ?? "canvas",
        target: {
          updateViewWithMouse: (coords) => {
            if (this.isMouseTrackingSuspended()) {
              return;
            }

            mouseTrackableRenderer.updateViewWithMouse(coords);
          },
          handleMouseTap: (coords) => {
            if (this.isAiGazeActive()) {
              return;
            }

            mouseTrackableRenderer.handleMouseTap(coords);
          },
        },
      });
    }
  }

  /**
   * Load the model (if the renderer supports it)
   */
  async loadModel(modelPath: string): Promise<void> {
    if (this.renderer.loadModel) {
      await this.renderer.loadModel(modelPath);
    }
  }

  /**
   * Render a message
   */
  async render(message: Message, character?: Character): Promise<void> {
    const targetCharacter = character || this.character || undefined;

    await this.renderer.render(message, targetCharacter);
    this.messageCallback?.(message, targetCharacter);
  }

  /** Local-presence gaze (webcam), a peer of mouse-tracking. Yields to the AI
   *  gaze window (isAiGazeActive); while applying, suspends mouse CURSOR tracking
   *  (updateViewWithMouse, NOT taps) via a separate local-gaze window so the
   *  static document mouse cursor target does not fight the webcam. Returns true
   *  when applied, false on no-op (AI owns the avatar, or the renderer has no lookAt). */
  setLocalGaze(coords: GazeCoordinates): boolean {
    if (this.isAiGazeActive()) return false; // yield to AI gaze ONLY
    if (!this.hasGazeControl(this.renderer)) return false;
    this.renderer.lookAt(coords);
    this.localGazeSuspendUntil = Date.now() + LOCAL_GAZE_SUSPEND_MS; // beat mouse
    return true;
  }

  /**
   * Clean up
   */
  async destroy(): Promise<void> {
    this.disconnect();
    this.cleanupMouseTracking?.();
    this.cleanupMouseTracking = undefined;

    if (this.resumeMouseTrackingTimer) {
      clearTimeout(this.resumeMouseTrackingTimer);
      this.resumeMouseTrackingTimer = undefined;
    }

    if (this.expressionReleaseTimer) {
      clearTimeout(this.expressionReleaseTimer);
      this.expressionReleaseTimer = undefined;
    }

    await this.renderer.destroy();
  }

  /**
   * Deactivate real-time lip-sync: tell the renderer to stop animating and
   * force the mouth closed, guaranteeing a clean rest state.
   */
  private deactivateRealtimeLipSync(): void {
    this.renderer.setRealtimeLipSync?.(false);
    this.renderer.updateRealtimeLipSyncRms?.(0);
  }

  /**
   * Update the lip-sync RMS
   */
  private updateLipSync(rms: number): void {
    this.renderer.updateRealtimeLipSyncRms?.(rms);
  }

  private applyExpression(expressionId: string): boolean {
    if (!this.hasExpressionControl(this.renderer)) {
      return false;
    }

    if (
      this.hasExpressionCatalog(this.renderer) &&
      !this.renderer.getAvailableExpressions().includes(expressionId)
    ) {
      return false;
    }

    const now = Date.now();
    if (
      this.lastExpression?.expressionId === expressionId &&
      now - this.lastExpression.at < EXPRESSION_DEBOUNCE_MS
    ) {
      return false;
    }

    this.renderer.playExpression(expressionId);
    this.lastExpression = { expressionId, at: now };

    if (this.expressionReleaseTimer) {
      clearTimeout(this.expressionReleaseTimer);
      this.expressionReleaseTimer = undefined;
    }

    if (this.renderer.stopExpression) {
      this.expressionReleaseTimer = setTimeout(() => {
        this.expressionReleaseTimer = undefined;
        this.renderer.stopExpression?.();
        this.lastExpression = undefined;
      }, EXPRESSION_HOLD_MS);
    }

    return true;
  }

  private applyMotion(motion: MotionSelection): boolean {
    if (!this.hasMotionControl(this.renderer)) {
      return false;
    }

    const index = motion.index ?? 0;

    if (this.hasMotionCatalog(this.renderer)) {
      const motionGroups = this.renderer.getAvailableMotionGroups();
      const count = motionGroups[motion.group];

      if (typeof count !== "number" || index < 0 || index >= count) {
        return false;
      }
    }

    const now = Date.now();
    if (
      this.lastMotion?.group === motion.group &&
      this.lastMotion.index === index &&
      now - this.lastMotion.at < MOTION_DEBOUNCE_MS
    ) {
      return false;
    }

    this.renderer.playMotionByGroup(motion.group, index);
    this.lastMotion = { group: motion.group, index, at: now };
    return true;
  }

  private applyGaze(coords: GazeCoordinates): boolean {
    if (!this.hasGazeControl(this.renderer)) {
      return false;
    }

    this.renderer.lookAt(coords);
    this.suspendMouseTracking(GAZE_MOUSE_SUSPEND_MS);

    return true;
  }

  private suspendMouseTracking(durationMs: number): void {
    this.mouseTrackingSuspendedUntil = Date.now() + durationMs;

    if (this.resumeMouseTrackingTimer) {
      clearTimeout(this.resumeMouseTrackingTimer);
    }

    this.resumeMouseTrackingTimer = setTimeout(() => {
      this.mouseTrackingSuspendedUntil = 0;
      this.resumeMouseTrackingTimer = undefined;
    }, durationMs);
  }

  private isAiGazeActive(): boolean {
    return Date.now() < this.mouseTrackingSuspendedUntil;
  }

  private isMouseTrackingSuspended(): boolean {
    return this.isAiGazeActive() || Date.now() < this.localGazeSuspendUntil;
  }

  private isMouseTrackable(
    renderer: Renderer,
  ): renderer is Renderer & MouseTrackable {
    return (
      "updateViewWithMouse" in renderer &&
      typeof renderer.updateViewWithMouse === "function" &&
      "handleMouseTap" in renderer &&
      typeof renderer.handleMouseTap === "function"
    );
  }

  private hasExpressionControl(
    renderer: Renderer,
  ): renderer is Renderer & { playExpression(expressionId: string): void } {
    return (
      "playExpression" in renderer &&
      typeof renderer.playExpression === "function"
    );
  }

  private hasExpressionCatalog(
    renderer: Renderer,
  ): renderer is Renderer & { getAvailableExpressions(): string[] } {
    return (
      "getAvailableExpressions" in renderer &&
      typeof renderer.getAvailableExpressions === "function"
    );
  }

  private hasMotionControl(renderer: Renderer): renderer is Renderer & {
    playMotionByGroup(group: string, index: number): void;
  } {
    return (
      "playMotionByGroup" in renderer &&
      typeof renderer.playMotionByGroup === "function"
    );
  }

  private hasMotionCatalog(renderer: Renderer): renderer is Renderer & {
    getAvailableMotionGroups(): Record<string, number>;
  } {
    return (
      "getAvailableMotionGroups" in renderer &&
      typeof renderer.getAvailableMotionGroups === "function"
    );
  }

  private hasGazeControl(
    renderer: Renderer,
  ): renderer is Renderer & { lookAt(coords: GazeCoordinates): void } {
    return "lookAt" in renderer && typeof renderer.lookAt === "function";
  }
}

/**
 * Helper function to create a Render Manager
 */
export function createRenderManager(
  renderer: Renderer,
  options?: RenderManagerOptions,
): IRenderManager {
  return new RenderManager(renderer, options);
}
