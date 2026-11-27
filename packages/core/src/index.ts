import { resolveAffect } from "./affect";
import { EventBus } from "./bus";
import { Floor } from "./floor";
import {
  AffectMap,
  Character,
  CharacterBody,
  ConversationBrain,
  FloorState,
  RenderManager,
  TTSManager,
  STTManager,
  PerformanceHandle,
  PerformRequest,
  ReactionHandle,
  ReactRequest,
  RealtimeManager,
} from "./types";
import {
  CharivoDisposeError,
  CharivoStateError,
  toCharivoError,
  type CharivoError,
} from "./errors";

export * from "./types";
export {
  type BrowserLifecycleCallbacks,
  subscribeBrowserLifecycle,
} from "./browser-lifecycle";
export {
  type CharivoErrorCode,
  type CharivoErrorOptions,
  CharivoError,
  CharivoStateError,
  CharivoTimeoutError,
  CharivoTransportError,
  CharivoProviderError,
  CharivoDisposeError,
  type CharivoErrorKind,
  isCharivoError,
  getErrorMessage,
  toCharivoError,
} from "./errors";
export {
  createLipSyncAnalyzer,
  type LipSyncAnalyzer,
  type LipSyncAnalyzerOptions,
} from "./lipsync-analyzer";
export {
  assertToolResultObject,
  validateToolArguments,
} from "./tool-validation";
export {
  createToolFailureOutput,
  createToolRegistry,
  snapshotToolResult,
  type ToolRegistry,
  type ToolResultSnapshot,
  withToolTimeout,
} from "./tool-execution";
export {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  type FetchWithTimeoutOptions,
  readResponseErrorMessage,
} from "./fetch-with-timeout";

/**
 * The one body each attached brain belongs to. Kept on `globalThis`, since the
 * ESM and CommonJS builds are separate module instances that must still see
 * the same owners.
 */
const BRAIN_OWNED_MESSAGE =
  "The brain is attached to another Charivo instance; detach it there first";
const BRAIN_OWNERS_KEY = Symbol.for("@charivo/core.brainOwners");
const brainOwners: WeakMap<ConversationBrain, Charivo> = ((
  globalThis as { [BRAIN_OWNERS_KEY]?: WeakMap<ConversationBrain, Charivo> }
)[BRAIN_OWNERS_KEY] ??= new WeakMap());

export class Charivo implements CharacterBody {
  private eventBus: EventBus;
  private renderManager?: RenderManager;
  private ttsManager?: TTSManager;
  private sttManager?: STTManager;
  private realtimeManager?: import("./types").RealtimeManager;
  private brain?: ConversationBrain;
  private character?: Character;
  private isRealtimeMode = false;
  private affectMap: AffectMap | null = null;
  private reactionSeq = 0;
  private readonly floor: Floor;

  constructor() {
    this.eventBus = new EventBus();
    this.floor = new Floor(this.eventBus, {
      getRenderManager: () => this.renderManager,
      getTTSManager: () => this.ttsManager,
      getCharacter: () => this.character,
      getAffectMap: () => this.affectMap,
    });
  }

  /**
   * Attach a render manager to handle character visualization.
   * Automatically connects the event bus and sets the current character if available.
   */
  attachRenderer(renderManager: RenderManager): void {
    // Disconnect the currently-attached manager before replacing it (fixes replace leak)
    if (this.renderManager && this.renderManager !== renderManager) {
      this.renderManager.disconnect();
    }

    this.renderManager = renderManager;
    this.connectRenderManagerEventBus(renderManager);

    // Set character if it was already configured
    if (this.character) {
      renderManager.setCharacter(this.character);
    }
  }

  /**
   * Connects the render manager to the event bus for bidirectional communication.
   */
  private connectRenderManagerEventBus(renderManager: RenderManager): void {
    renderManager.setEventBus(this.eventBus);
  }

  /**
   * Attach a TTS manager to handle voice synthesis.
   * Automatically connects the event emitter for audio events.
   */
  attachTTS(manager: TTSManager): void {
    this.ttsManager = manager;
    this.connectTTSManagerEventEmitter(manager);
  }

  /**
   * Detach the TTS manager to disable voice synthesis.
   */
  detachTTS(): void {
    this.ttsManager = undefined;
  }

  /**
   * Attach an STT manager to handle speech recognition.
   * Automatically connects the event emitter for STT events.
   */
  attachSTT(manager: STTManager): void {
    this.sttManager = manager;
    this.connectSTTManagerEventEmitter(manager);
  }

  /**
   * Detach the STT manager to disable speech recognition.
   */
  detachSTT(): void {
    this.sttManager = undefined;
  }

  /**
   * Detach the render manager without destroying it.
   */
  detachRenderer(): void {
    this.renderManager?.disconnect();
    this.renderManager = undefined;
  }

  /**
   * Connects the TTS manager to the event bus for audio event emission.
   */
  private connectTTSManagerEventEmitter(manager: TTSManager): void {
    if (manager.setEventEmitter) {
      manager.setEventEmitter(this.eventBus);
    }
  }

  /**
   * Connects the STT manager to the event bus for speech recognition event emission.
   */
  private connectSTTManagerEventEmitter(manager: STTManager): void {
    if (manager.setEventEmitter) {
      manager.setEventEmitter(this.eventBus);
    }
  }

  /**
   * Set the character for this Charivo instance.
   * Automatically propagates to the attached renderer, realtime manager and
   * brain.
   */
  setCharacter(character: Character): void {
    this.character = character;

    if (this.renderManager) {
      this.renderManager.setCharacter(character);
    }

    if (this.realtimeManager) {
      this.realtimeManager.setCharacter(character);
    }

    this.brain?.setCharacter(character);
  }

  /**
   * Attach the conversation brain. It receives this instance as its body and,
   * when a character is set, the character. A brain attached before is
   * detached first.
   */
  attachBrain(brain: ConversationBrain): void {
    // Two bodies would share one history and cancel each other's turns on
    // detach. Checked before the current brain is detached, so a refusal
    // changes nothing here.
    const owner = brainOwners.get(brain);
    if (owner && owner !== this) {
      throw new CharivoStateError(BRAIN_OWNED_MESSAGE);
    }
    // Reserved before the outgoing brain's detach callback can run, so that
    // callback cannot hand the incoming brain to another body.
    brainOwners.set(brain, this);
    try {
      this.detachBrain();
    } catch (error) {
      if (this.brain !== brain && brainOwners.get(brain) === this) {
        brainOwners.delete(brain);
      }
      throw error;
    }
    if (this.brain !== undefined) {
      // The detach callback attached a newer brain here; it wins.
      if (brainOwners.get(brain) === this && this.brain !== brain) {
        brainOwners.delete(brain);
      }
      return;
    }
    // Re-reserved: detaching this very brain released it.
    brainOwners.set(brain, this);
    this.brain = brain;
    try {
      brain.setBody(this);
    } catch (error) {
      if (this.brain === brain) {
        this.brain = undefined;
        brainOwners.delete(brain);
      }
      throw error;
    }
    // setBody() may have attached another brain; this one is then detached.
    if (this.brain === brain && this.character) {
      brain.setCharacter(this.character);
    }
  }

  detachBrain(): void {
    const brain = this.brain;
    this.brain = undefined;
    try {
      brain?.setBody(null);
    } finally {
      // Released after the callback, so the brain stays owned while it runs.
      if (brain && this.brain !== brain && brainOwners.get(brain) === this) {
        brainOwners.delete(brain);
      }
    }
  }

  getBrain(): ConversationBrain | undefined {
    return this.brain;
  }

  /**
   * Take the floor and perform one line: render it as a character message,
   * then speak it with the character's voice on the TTS manager attached at
   * this call. {@link PerformRequest} says when it throws; `started` and
   * `done` never reject, and a render or TTS failure ends the performance
   * `failed`.
   */
  perform(request: PerformRequest): PerformanceHandle {
    return this.floor.perform(request);
  }

  /**
   * Show a non-verbal reaction without taking the floor. {@link ReactRequest}
   * says what it emits; `critical` (priority `"reflex"` only) also cancels the
   * performance on the floor. The handle's `release()` names this reaction's
   * claim, so it never clears a newer one; core keeps no record of claims.
   */
  react(request: ReactRequest): ReactionHandle {
    const priority = request.priority ?? "reflex";
    if (request.critical && priority !== "reflex") {
      throw new CharivoStateError(
        'react() takes critical only with priority "reflex"',
      );
    }

    const resolved = resolveAffect(request, this.affectMap);
    // Cancelled first, so a listener of the reaction's events finds the
    // floor already free. Called from a floor-event listener, the cancel's
    // performance:end and floor:changed are queued behind the delivery in
    // progress, so they arrive after the reaction's events.
    if (request.critical) {
      this.floor.cancelHolder();
    }

    this.reactionSeq += 1;
    const claimId = `reaction-${Date.now()}-${this.reactionSeq}`;
    const { source, hold, gaze } = request;
    const claimed: Array<"expression" | "gaze"> = [];
    if (resolved.expressionId !== undefined) {
      claimed.push("expression");
      this.eventBus.emit("avatar:expression", {
        expressionId: resolved.expressionId,
        source,
        hold,
        priority,
        claimId,
      });
    }
    if (gaze) {
      claimed.push("gaze");
      this.eventBus.emit("avatar:gaze", {
        x: gaze.x,
        y: gaze.y,
        source,
        hold,
        priority,
        claimId,
      });
    }
    if (resolved.motion) {
      // Decision 6: a body motion is muted.
      this.eventBus.emit("avatar:motion", {
        group: resolved.motion.group,
        index: resolved.motion.index ?? 0,
        muteSound: true,
        priority,
      });
    }

    let released = false;
    return {
      resolved,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        for (const channel of claimed) {
          this.eventBus.emit("avatar:release", { source, channel, claimId });
        }
      },
    };
  }

  /**
   * Replace the map `{ affect, intensity? }` cues resolve through, or clear it
   * with `null`. Set it again when the model changes.
   */
  setAffectMap(map: AffectMap | null): void {
    this.affectMap = map;
  }

  /** Who holds playback now; `floor:changed` reports every change. */
  getFloor(): FloorState {
    return this.floor.getFloor();
  }

  /**
   * Stop the speech on the floor now. Speech only: it touches no brain turn;
   * use the brain's `interrupt()` to cut one off.
   *
   * The performance on the floor ends `cancelled` and the TTS manager it
   * speaks on is stopped, which a later `attachTTS()` does not change. Speech
   * an earlier stop failed to silence is stopped again, and a stop already in
   * progress is joined rather than repeated. When the floor supplied no stop,
   * the attached TTS manager is stopped. Resolving means every one of those
   * stops has completed, so no audio from what was interrupted starts
   * afterwards; it rejects with the typed provider error of the first that
   * failed.
   *
   * Realtime mode is not covered — this does not delegate to the realtime
   * manager. Use `getRealtimeManager()?.interrupt()` there.
   */
  async interrupt(): Promise<void> {
    await this.floor.interrupt(this.ttsManager);
  }

  /**
   * Get the currently configured character.
   */
  getCurrentCharacter(): Character | null {
    return this.character ?? null;
  }

  /**
   * Get the current STT manager instance.
   */
  getSTTManager(): STTManager | undefined {
    return this.sttManager;
  }

  /**
   * Get the current render manager instance.
   */
  getRenderManager(): RenderManager | undefined {
    return this.renderManager;
  }

  /**
   * Get the current TTS manager instance.
   */
  getTTSManager(): TTSManager | undefined {
    return this.ttsManager;
  }

  /**
   * Attach a Realtime manager to handle real-time conversation.
   * Automatically connects the event emitter and enables Realtime mode.
   *
   * Realtime holds playback until {@link Charivo.detachRealtime}: the floor is
   * `realtime` and `perform()` is refused. Throws `CharivoStateError` while a
   * performance holds the floor or cancelled speech has not been confirmed
   * stopped; await {@link Charivo.interrupt} first, and when that rejects,
   * attaching stays refused until a later stop succeeds.
   *
   * When the manager's `setEventEmitter()` or `setCharacter()` throws, the
   * error is rethrown with realtime detached and the floor idle, as after
   * {@link Charivo.detachRealtime}; a manager attached before is not restored.
   */
  attachRealtime(manager: import("./types").RealtimeManager): void {
    this.floor.assertRealtimeAdmissible();
    this.realtimeManager = manager;
    this.isRealtimeMode = true;
    // Reserved before the manager is wired: its setCharacter() emits state on
    // the bus, and a perform() from a listener must already be refused (R1).
    this.floor.setRealtime(true);

    // A floor:changed listener may have detached or replaced this manager;
    // wiring it then would connect a manager that is no longer attached.
    if (this.realtimeManager !== manager) {
      return;
    }

    try {
      this.connectRealtimeManagerEventEmitter(manager);

      if (this.character) {
        manager.setCharacter(this.character);
      }
    } catch (error) {
      if (this.realtimeManager === manager) {
        this.detachRealtime();
      }
      throw error;
    }
  }

  /**
   * Detach the Realtime manager and disable Realtime mode, freeing the floor.
   * The session is not touched: stop it first.
   */
  detachRealtime(): void {
    this.realtimeManager = undefined;
    this.isRealtimeMode = false;
    this.floor.setRealtime(false);
  }

  /**
   * Check if Realtime mode is enabled.
   */
  isRealtimeModeEnabled(): boolean {
    return this.isRealtimeMode;
  }

  /**
   * Connects the Realtime manager to the event bus.
   */
  private connectRealtimeManagerEventEmitter(
    manager: import("./types").RealtimeManager,
  ): void {
    if (manager.setEventEmitter) {
      manager.setEventEmitter(this.eventBus);
    }
  }

  /**
   * Get the current Realtime manager instance.
   */
  getRealtimeManager(): import("./types").RealtimeManager | undefined {
    return this.realtimeManager;
  }

  /**
   * Subscribe to events from the event bus.
   */
  on<K extends keyof import("./types").EventMap>(
    event: K,
    listener: (data: import("./types").EventMap[K]) => void,
  ): void {
    this.eventBus.on(event, listener);
  }

  /**
   * Unsubscribe from events from the event bus.
   */
  off<K extends keyof import("./types").EventMap>(
    event: K,
    listener: (data: import("./types").EventMap[K]) => void,
  ): void {
    this.eventBus.off(event, listener);
  }

  /**
   * Emit events to the event bus.
   */
  emit<K extends keyof import("./types").EventMap>(
    event: K,
    data: import("./types").EventMap[K],
  ): void {
    this.eventBus.emit(event, data);
  }

  async dispose(): Promise<void> {
    let firstError: CharivoError | null = null;

    const recordError = (error: unknown, fallbackMessage: string): void => {
      const typedError = toCharivoError("dispose", error, fallbackMessage);
      if (!firstError) {
        firstError = typedError;
      }
    };

    // A TTS stop fails with the same type whichever stop failed: a dispose
    // error whose cause is the provider error.
    const recordStopFailure = (error: unknown): void => {
      const message =
        error instanceof Error ? error.message : "Failed to stop TTS";
      recordError(new CharivoDisposeError(message, { cause: error }), message);
    };

    // The brain first: it cancels its live turn, which settles the floor's
    // performance before the floor is torn down below.
    if (this.brain) {
      try {
        await this.brain.dispose?.();
      } catch (error) {
        recordError(error, "Failed to dispose brain during dispose");
      }
      try {
        this.detachBrain();
      } catch (error) {
        recordError(error, "Failed to detach brain during dispose");
      }
    }

    // The floor's performance and the speech it left unsettled go first (P9).
    for (const failure of await this.floor.dispose()) {
      recordStopFailure(failure);
    }

    if (this.realtimeManager) {
      try {
        await this.realtimeManager.stopSession();
      } catch (error) {
        recordError(error, "Failed to stop realtime session during dispose");
      }
    }

    if (this.ttsManager) {
      try {
        // Through the floor, so it joins a stop already in progress there
        // and the floor knows when the speech it cancelled has stopped (P9).
        await this.floor.stop(this.ttsManager);
      } catch (error) {
        recordStopFailure(error);
      }

      // Runs even when stop() failed: audio resources must still be released.
      try {
        await this.ttsManager.dispose?.();
      } catch (error) {
        recordError(error, "Failed to release TTS resources during dispose");
      }
    }

    if (this.sttManager) {
      try {
        if (this.sttManager.isRecording()) {
          await this.sttManager.stop();
        }
      } catch (error) {
        recordError(error, "Failed to stop STT during dispose");
      }
    }

    if (this.renderManager) {
      try {
        await this.renderManager.destroy();
      } catch (error) {
        recordError(error, "Failed to destroy renderer during dispose");
      }
    }

    this.detachRealtime();
    this.detachTTS();
    this.detachSTT();
    // renderManager was already destroyed+disconnected in the guarded block above;
    // bypass detachRenderer() here to avoid a second disconnect() call.
    this.renderManager = undefined;
    this.character = undefined;
    this.affectMap = null;
    this.isRealtimeMode = false;
    this.floor.clear();
    this.eventBus.clear();
    this.floor.installAudioWatch();

    return this.finishDispose(firstError);
  }

  private finishDispose(firstError: CharivoError | null): void {
    if (firstError) {
      throw firstError;
    }
  }
}

/**
 * Managers and character to wire into a new {@link Charivo}.
 *
 * Every field is optional — an instance with no managers is valid, and each
 * modality is attached only when supplied. `null` is accepted alongside
 * `undefined` so callers can pass a manager they hold as nullable state (a
 * React ref, a feature-flagged modality) without converting it first.
 */
export interface CharivoOptions {
  tts?: TTSManager | null;
  stt?: STTManager | null;
  realtime?: RealtimeManager | null;
  renderer?: RenderManager | null;
  character?: Character | null;
  brain?: ConversationBrain | null;
}

/**
 * Create a Charivo instance with its managers already attached.
 *
 * Equivalent to `new Charivo()` followed by the matching `attach*` calls, then
 * `setCharacter()`. The character is applied last so it reaches every
 * character-aware manager supplied above it — the renderer, realtime manager
 * and brain. Hand-wiring works in either order only because `attach*`
 * re-applies an already-set character, and that coupling is easy to miss.
 *
 * Note that supplying `realtime` also enables realtime mode, exactly as
 * `attachRealtime()` does.
 */
export function createCharivo(options: CharivoOptions = {}): Charivo {
  // Before any manager is wired to the new instance: a refused call must not
  // take the supplied managers' events away from the instance running now.
  if (options.brain && brainOwners.has(options.brain)) {
    throw new CharivoStateError(BRAIN_OWNED_MESSAGE);
  }
  const charivo = new Charivo();

  if (options.renderer) {
    charivo.attachRenderer(options.renderer);
  }

  if (options.tts) {
    charivo.attachTTS(options.tts);
  }

  if (options.stt) {
    charivo.attachSTT(options.stt);
  }

  if (options.realtime) {
    charivo.attachRealtime(options.realtime);
  }

  if (options.brain) {
    charivo.attachBrain(options.brain);
  }

  if (options.character) {
    try {
      charivo.setCharacter(options.character);
    } catch (error) {
      // The caller never gets this instance, so nothing else could release
      // the brain it holds.
      charivo.detachBrain();
      throw error;
    }
  }

  return charivo;
}
