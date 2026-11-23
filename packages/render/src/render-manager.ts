import {
  type AvatarClaimPriority,
  type Character,
  type EventMap,
  type GazeCoordinates,
  type Message,
  type MotionPriority,
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

// The default hold of a gaze claim: how long an AI gaze target keeps the
// cursor and local-presence gaze off the eyes.
const GAZE_HOLD_MS = 1_200;
const LOCAL_GAZE_SUSPEND_MS = 700;
const MOTION_DEBOUNCE_MS = 1_000;
const MOTION_PRIORITY: Record<AvatarClaimPriority, MotionPriority> = {
  reflex: "force",
  explicit: "normal",
  inferred: "normal",
  ambient: "idle",
};
// The pre-speech window: how long a speech-scoped expression waits for the
// speech it accompanies to start. Text-only setups never emit
// tts:audio:start/end, so this is what drops their face back. It is NOT a
// ceiling on speech: once bound to a span, the claim lasts until that span
// ends, because a reply longer than the window would otherwise reset the
// expression mid-sentence. It is also how long a `{ performance }` hold, on
// the expression and the gaze channel alike, waits for that performance to
// start. Internal constant, no public knob by design.
const EXPRESSION_HOLD_MS = 8_000;
// How many ended performance ids are remembered, so a claim or start that
// arrives after its performance:end is recognised as late.
const ENDED_PERFORMANCE_MEMORY = 32;

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
      // Recorded first: a renderer may emit another claim from inside the call.
      this.shownExpression = expressionId;
      this.renderer.playExpression?.(expressionId);
    },
    clear: () => {
      // A renderer without stopExpression keeps the last face, so the claims
      // still expire (a lower one can take over) but nothing is reset.
      if (this.hasExpressionRelease(this.renderer)) {
        this.shownExpression = undefined;
        this.renderer.stopExpression();
      }
    },
    defaultHold: "speech",
    preSpeechWindowMs: EXPRESSION_HOLD_MS,
  });
  private readonly gaze: ClaimChannel<GazeCoordinates> = createClaimChannel({
    show: (coords) => this.renderer.lookAt?.(coords),
    // Without this the renderer would keep the released target (Iki even
    // reapplies it to the next model it loads) until the next cursor or
    // local-gaze input.
    clear: () => this.renderer.clearGaze?.(),
    defaultHold: { ms: GAZE_HOLD_MS },
    preSpeechWindowMs: EXPRESSION_HOLD_MS,
    equals: (a, b) => a.x === b.x && a.y === b.y,
  });
  /** The channels that hold claims: spans, releases and loads reach each one. */
  private readonly heldChannels = [this.expressions, this.gaze];
  /**
   * The open tts:audio session, reported as an anonymous speech span. A fresh
   * symbol per session, so no claim can bind to an earlier session by id.
   */
  private audioSpan?: symbol;
  /** Voiced performances in progress; while any is open, audio opens no span. */
  private readonly openVoicedPerformances = new Set<string>();
  /** The last ended performance ids heard on the current bus, oldest first. */
  private readonly endedPerformances = new Set<string>();
  /** Numbers each loadModel() call; avatar claims wait while the latest is pending. */
  private loadSeq = 0;
  private pendingLoad?: number;
  private lastMotion?: { group: string; index: number; at: number };
  /** The current bus and how to remove what setEventBus() registered on it. */
  private binding?: { bus: CharivoEventBus; off: Array<() => void> };

  // Bus handlers; setEventBus() registers each one per binding.
  private readonly handleTtsAudioStart = (
    _data: EventMap["tts:audio:start"],
  ): void => {
    // A repeated start inside one session is the same speech, not a new span,
    // and audio inside a voiced performance is that performance's speech.
    if (!this.audioSpan && this.openVoicedPerformances.size === 0) {
      this.audioSpan = Symbol("tts:audio");
      for (const channel of this.heldChannels) {
        channel.spanStarted(this.audioSpan, { speech: true });
      }
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
      for (const channel of this.heldChannels) {
        channel.spanEnded(span);
      }
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

  private readonly handleAvatarRelease = (
    data: EventMap["avatar:release"],
  ): void => {
    if (data.channel === undefined || data.channel === "expression") {
      this.expressions.release(data.source);
    }
    if (data.channel === undefined || data.channel === "gaze") {
      this.gaze.release(data.source);
    }
  };

  private readonly handlePerformanceStart = (
    data: EventMap["performance:start"],
  ): void => {
    // The bus is synchronous, so a listener ahead of this one can end the
    // performance inside its own start: that end was already heard here.
    if (this.endedPerformances.has(data.performanceId)) {
      return;
    }
    // A restart may change whether the performance is voiced.
    if (data.voiced) {
      this.openVoicedPerformances.add(data.performanceId);
    } else {
      this.openVoicedPerformances.delete(data.performanceId);
    }
    for (const channel of this.heldChannels) {
      channel.spanStarted(data.performanceId, { speech: data.voiced });
    }
  };

  private readonly handlePerformanceEnd = (
    data: EventMap["performance:end"],
  ): void => {
    this.endedPerformances.delete(data.performanceId);
    this.endedPerformances.add(data.performanceId);
    if (this.endedPerformances.size > ENDED_PERFORMANCE_MEMORY) {
      const [oldest] = this.endedPerformances;
      this.endedPerformances.delete(oldest!);
    }
    this.openVoicedPerformances.delete(data.performanceId);
    for (const channel of this.heldChannels) {
      channel.spanEnded(data.performanceId);
    }
  };

  private readonly handleAvatarMotion = (
    data: EventMap["avatar:motion"],
  ): void => {
    // muteSound is carried, not inferred: this event is public, so an
    // application may emit it too and an unflagged emit must stay audible.
    this.applyMotion(
      { group: data.group, index: data.index },
      data.muteSound,
      data.priority ?? "explicit",
    );
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
    if (this.binding?.bus === eventBus) {
      return;
    }

    // Defensive self-clear: avoid double-registering if called again. Uses
    // the listener-only unbind (not disconnect()) so a rewire keeps the
    // claims instead of dropping them.
    this.unbindEventBus();

    const binding = { bus: eventBus, off: [] as Array<() => void> };
    this.binding = binding;
    const on = <K extends keyof EventMap>(
      event: K,
      handler: (data: EventMap[K]) => void,
    ): void => {
      // The bus dispatches from a snapshot, so this callback still runs for
      // an event during which a listener ahead of it detached the manager or
      // swapped its bus. Acting then would create a claim nothing can
      // release, or write into the next binding's state.
      const listener = (data: EventMap[K]): void => {
        if (this.binding === binding) {
          handler(data);
        }
      };
      eventBus.on(event, listener);
      binding.off.push(() => eventBus.off(event, listener));
    };

    on("tts:audio:start", this.handleTtsAudioStart);
    on("tts:audio:end", this.handleTtsAudioEnd);
    on("tts:lipsync:update", this.handleTtsLipsyncUpdate);
    on("avatar:expression", this.handleAvatarExpression);
    on("avatar:motion", this.handleAvatarMotion);
    on("avatar:gaze", this.handleAvatarGaze);
    on("avatar:release", this.handleAvatarRelease);
    on("performance:start", this.handlePerformanceStart);
    on("performance:end", this.handlePerformanceEnd);
  }

  /**
   * Remove the event bus listeners, keeping the claims. Does nothing if no
   * bus is connected.
   */
  private unbindEventBus(): void {
    if (!this.binding) {
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
    this.openVoicedPerformances.clear();
    for (const channel of this.heldChannels) {
      channel.spansLost();
    }
    // The ended ids belong to the bus they were heard on: the next bus may
    // start a performance under the same id.
    this.endedPerformances.clear();

    for (const off of this.binding.off) {
      off();
    }
    this.binding = undefined;
  }

  /**
   * Disconnect from the event bus and relinquish the renderer: unbinds the bus
   * listeners and, since the manager is giving up ownership of the renderer,
   * synchronously releases any held expression and gaze rather than leaving
   * them to a timer that may now outlive that ownership. Does nothing if no
   * bus is connected, and is safe to call multiple times.
   */
  disconnect(): void {
    if (!this.binding) {
      return;
    }

    this.unbindEventBus();
    for (const channel of this.heldChannels) {
      channel.releaseAll();
    }
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
   * when the renderer has no `loadModel`. Avatar claims that arrive while the
   * latest call is pending are ignored.
   */
  async loadModel(modelPath: string): Promise<void> {
    if (!this.renderer.loadModel) {
      return;
    }

    // Only the latest call gates: once it settles the renderer can no longer
    // install an earlier one, so an older call blocks and resumes nothing.
    const load = ++this.loadSeq;
    this.pendingLoad = load;
    try {
      // A claim carried across the swap would count as showing on a model
      // that never received it: a repeated expression would never be played,
      // and a gaze target would keep cursor and local gaze suspended. Released
      // while the load is pending, so a claim a renderer emits during the
      // release is ignored too.
      for (const channel of this.heldChannels) {
        channel.releaseAll();
      }
      // The debounce remembers a clip of the model being replaced.
      this.lastMotion = undefined;
      // A renderer's cleanup callback may have started a newer load.
      if (load !== this.loadSeq) {
        return;
      }
      await this.renderer.loadModel(modelPath);
      // The new model starts on its base face even where stopExpression is
      // missing; a failed load keeps the old model and the face it shows. An
      // older call that resolves while the latest is pending may have
      // installed its model, and stays on screen if the latest then fails.
      if (this.pendingLoad !== undefined) {
        this.shownExpression = undefined;
      }
    } finally {
      if (this.pendingLoad === load) {
        this.pendingLoad = undefined;
      }
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

  /** Local-presence gaze (webcam), a peer of mouse-tracking. Yields to a live
   *  AI gaze claim (isAiGazeActive); while applying, suspends mouse CURSOR tracking
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
    // An id cannot be checked against a catalog that is about to change.
    if (this.pendingLoad !== undefined) {
      return false;
    }
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

    if (this.isEndedPerformanceHold(data.hold)) {
      return false;
    }

    return this.expressions.claim({
      source: data.source ?? "app",
      priority: data.priority ?? "explicit",
      value: data.expressionId,
      hold: data.hold,
    });
  }

  private applyMotion(
    motion: MotionSelection,
    muteSound: boolean | undefined,
    claimPriority: AvatarClaimPriority,
  ): boolean {
    // A motion checked against a catalog that is about to change could name
    // a clip the incoming model lacks.
    if (this.pendingLoad !== undefined) {
      return false;
    }
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
    // The debounce runs before the renderer and cannot tell a declined motion
    // from a played one, so a reflex skips it: it must always reach the
    // renderer, which alone knows what clip is running.
    if (
      claimPriority !== "reflex" &&
      this.lastMotion?.group === motion.group &&
      this.lastMotion.index === index &&
      now - this.lastMotion.at < MOTION_DEBOUNCE_MS
    ) {
      return false;
    }

    // Unflagged calls keep today's exact two-argument shape, so a renderer that
    // never learned about the options sees no change at all. The priority is
    // forwarded, never tracked here: admission is the renderer's call.
    const priority = MOTION_PRIORITY[claimPriority];
    let accepted: boolean | void;
    if (muteSound || priority !== "normal") {
      accepted = this.renderer.playMotionByGroup(motion.group, index, {
        ...(muteSound ? { muteSound: true } : {}),
        ...(priority !== "normal" ? { priority } : {}),
      });
    } else {
      accepted = this.renderer.playMotionByGroup(motion.group, index);
    }
    // A motion the renderer declined never played, so recording it would
    // debounce the same request once the clip that blocked it has ended. An
    // idle-priority motion is also left unrecorded: it must not debounce a
    // following ordinary request for that clip.
    if (accepted !== false && priority !== "idle") {
      this.lastMotion = { group: motion.group, index, at: now };
    }
    return true;
  }

  private applyGaze(data: EventMap["avatar:gaze"]): boolean {
    // A target is applied to the current model only, so a claim made now
    // would suspend cursor and local gaze on a model that never received it.
    if (this.pendingLoad !== undefined) {
      return false;
    }
    if (!this.hasGazeControl(this.renderer)) {
      return false;
    }
    if (this.isEndedPerformanceHold(data.hold)) {
      return false;
    }
    // Rejected before the claim, so a bad target cannot replace the source's
    // live claim.
    if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) {
      return false;
    }

    return this.gaze.claim({
      source: data.source ?? "app",
      priority: data.priority ?? "explicit",
      value: { x: data.x, y: data.y },
      hold: data.hold,
    });
  }

  /**
   * A straggler for a performance that already ended. It is ignored rather
   * than replacing the source's claim, which may belong to a newer line.
   */
  private isEndedPerformanceHold(hold: unknown): boolean {
    return (
      typeof hold === "object" &&
      hold !== null &&
      "performance" in hold &&
      typeof hold.performance === "string" &&
      this.endedPerformances.has(hold.performance)
    );
  }

  private isAiGazeActive(): boolean {
    return this.gaze.isActive();
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
      options?: { muteSound?: boolean; priority?: MotionPriority },
    ): boolean | void;
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
