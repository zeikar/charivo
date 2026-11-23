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
import { createClaimChannel, type ClaimChannel } from "./claim-channel";
import {
  setupMouseTracking,
  type MouseTrackable,
  type MouseTrackingCleanup,
  type MouseTrackingMode,
} from "./mouse-tracking";

const GAZE_MOUSE_SUSPEND_MS = 1_200;
const LOCAL_GAZE_SUSPEND_MS = 700;
const MOTION_DEBOUNCE_MS = 1_000;
// The pre-speech window: how long a speech-scoped expression waits for the
// speech it accompanies to start. Text-only setups never emit
// tts:audio:start/end, so this is what drops their face back. It is NOT a
// ceiling on speech: once bound to a span, the claim lasts until that span
// ends, because a reply longer than the window would otherwise reset the
// expression mid-sentence. Internal constant, no public knob by design.
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
  private mouseTrackingSuspendedUntil = 0;
  private localGazeSuspendUntil = 0;
  /** The expression last handed to the renderer and not since stopped. */
  private shownExpression?: string;
  private readonly expressions: ClaimChannel<string> = createClaimChannel({
    show: (expressionId) => {
      // Without stopExpression an expired face stays up, so showing it again
      // would only replay it.
      if (expressionId === this.shownExpression) {
        return;
      }
      this.renderer.playExpression?.(expressionId);
      this.shownExpression = expressionId;
    },
    clear: () => {
      // A renderer without stopExpression keeps the last face, so the claims
      // still expire (a lower one can take over) but nothing is reset.
      if (this.hasExpressionRelease(this.renderer)) {
        this.renderer.stopExpression();
        this.shownExpression = undefined;
      }
    },
    defaultHold: "speech",
    preSpeechWindowMs: EXPRESSION_HOLD_MS,
  });
  /**
   * The open tts:audio session, reported as an anonymous speech span. A fresh
   * symbol per session, so no claim can bind to an earlier session by id.
   */
  private audioSpan?: symbol;
  private lastMotion?: { group: string; index: number; at: number };
  private eventBus?: CharivoEventBus;

  // Stable handler references so they can be removed by reference in disconnect()
  private readonly handleTtsAudioStart = (
    _data: EventMap["tts:audio:start"],
  ): void => {
    // A repeated start inside one session is the same speech, not a new span.
    if (!this.audioSpan) {
      this.audioSpan = Symbol("tts:audio");
      this.expressions.spanStarted(this.audioSpan, { speech: true });
    }
    this.renderer.setRealtimeLipSync?.(true);
  };

  private readonly handleTtsAudioEnd = (
    _data: EventMap["tts:audio:end"],
  ): void => {
    this.deactivateRealtimeLipSync();

    const span = this.audioSpan;
    this.audioSpan = undefined;
    if (span) {
      this.expressions.spanEnded(span);
    }
  };

  private readonly handleTtsLipsyncUpdate = (
    data: EventMap["tts:lipsync:update"],
  ): void => {
    this.updateLipSync(data.rms);
  };

  private readonly handleAvatarExpression = (
    data: EventMap["avatar:expression"],
  ): void => {
    this.applyExpression(data);
  };

  private readonly handleAvatarMotion = (
    data: EventMap["avatar:motion"],
  ): void => {
    // muteSound is carried, not inferred: this event is public, so an
    // application may emit it too and an unflagged emit must stay audible.
    this.applyMotion({ group: data.group, index: data.index }, data.muteSound);
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
    // Re-attaching the same bus is a no-op. `Charivo.attachRenderer()` calls
    // this even for an already-attached manager, and tearing down would lose
    // the open speech span mid-utterance — putting its claims back on the
    // pre-speech window, and dropping realtime lip sync until the next audio
    // start.
    if (this.eventBus === eventBus) {
      return;
    }

    // Defensive self-clear: avoid double-registering if called again. Uses
    // the listener-only unbind (not disconnect()) so a rewire keeps the
    // expression claims instead of dropping them.
    this.unbindEventBus();

    this.eventBus = eventBus;
    eventBus.on("tts:audio:start", this.handleTtsAudioStart);
    eventBus.on("tts:audio:end", this.handleTtsAudioEnd);
    eventBus.on("tts:lipsync:update", this.handleTtsLipsyncUpdate);
    eventBus.on("avatar:expression", this.handleAvatarExpression);
    eventBus.on("avatar:motion", this.handleAvatarMotion);
    eventBus.on("avatar:gaze", this.handleAvatarGaze);
  }

  /**
   * Remove the event bus listeners, keeping the expression claims. Does
   * nothing if no bus is connected.
   */
  private unbindEventBus(): void {
    if (!this.eventBus) {
      return;
    }

    // Deactivate lip-sync before removing listeners so the renderer cannot
    // be left with the mouth open after the bus is cleared.
    this.deactivateRealtimeLipSync();

    // Detaching mid-utterance means this manager will never see that
    // utterance's tts:audio:end, so a claim bound to it would have nothing
    // left to release it — setEventBus() rewiring deliberately keeps it — and
    // goes back to the pre-speech window instead.
    this.audioSpan = undefined;
    this.expressions.spansLost();

    this.eventBus.off("tts:audio:start", this.handleTtsAudioStart);
    this.eventBus.off("tts:audio:end", this.handleTtsAudioEnd);
    this.eventBus.off("tts:lipsync:update", this.handleTtsLipsyncUpdate);
    this.eventBus.off("avatar:expression", this.handleAvatarExpression);
    this.eventBus.off("avatar:motion", this.handleAvatarMotion);
    this.eventBus.off("avatar:gaze", this.handleAvatarGaze);
    this.eventBus = undefined;
  }

  /**
   * Disconnect from the event bus and relinquish the renderer: unbinds the bus
   * listeners and, since the manager is giving up ownership of the renderer,
   * synchronously releases any held expression rather than leaving it to a
   * timer that may now outlive that ownership. Does nothing if no bus is
   * connected, and is safe to call multiple times.
   */
  disconnect(): void {
    if (!this.eventBus) {
      return;
    }

    this.unbindEventBus();
    this.expressions.releaseAll();
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
   * Load the model through the renderer; resolves without loading anything
   * when the renderer has no `loadModel`.
   */
  async loadModel(modelPath: string): Promise<void> {
    if (this.renderer.loadModel) {
      // A claim carried across the swap would count as showing on a model
      // that never received it, so a repeat of it would never be played.
      this.expressions.releaseAll();
      await this.renderer.loadModel(modelPath);
      // The new model starts on its base face even where stopExpression is
      // missing; a failed load keeps the old model and the face it shows.
      this.shownExpression = undefined;
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

  private applyExpression(data: EventMap["avatar:expression"]): boolean {
    if (!this.hasExpressionControl(this.renderer)) {
      return false;
    }

    // Checked before the channel, so an id the model lacks never displaces
    // the source's live claim.
    if (
      this.hasExpressionCatalog(this.renderer) &&
      !this.renderer.getAvailableExpressions().includes(data.expressionId)
    ) {
      return false;
    }

    return this.expressions.claim({
      source: data.source ?? "app",
      priority: data.priority ?? "explicit",
      value: data.expressionId,
      hold: data.hold,
    });
  }

  private applyMotion(motion: MotionSelection, muteSound?: boolean): boolean {
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

    // Unflagged calls keep today's exact two-argument shape, so a renderer that
    // never learned about the option sees no change at all.
    if (muteSound) {
      this.renderer.playMotionByGroup(motion.group, index, { muteSound: true });
    } else {
      this.renderer.playMotionByGroup(motion.group, index);
    }
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

  private hasExpressionRelease(
    renderer: Renderer,
  ): renderer is Renderer & { stopExpression(): void } {
    return (
      "stopExpression" in renderer &&
      typeof renderer.stopExpression === "function"
    );
  }

  private hasMotionControl(renderer: Renderer): renderer is Renderer & {
    playMotionByGroup(
      group: string,
      index: number,
      options?: { muteSound?: boolean },
    ): void;
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
