import { EventBus } from "./bus";
import {
  Character,
  HistoryRollback,
  Message,
  RenderManager,
  TTSManager,
  STTManager,
  LLMManager,
  RealtimeManager,
} from "./types";
import { toCharivoError, type CharivoError } from "./errors";

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

/**
 * One `userSay()` turn. `epoch` identifies it: only the newest turn is live,
 * so a turn is stale as soon as a newer one installs itself. `rollback` holds
 * the single `{ manager, handle }` pair produced by the turn's own history
 * write, the only write a live pre-boundary failure undoes.
 */
interface TurnRecord {
  epoch: number;
  userMessageId: string;
  rollback?: { manager: LLMManager; handle: HistoryRollback };
}

/**
 * A queue position reserved at install, holding the user message until some
 * flush writes it. `inProgress` marks the entry a flush is currently writing,
 * which is what stops a reentrant flush from jumping ahead of it.
 */
interface TurnEntry {
  message: Message;
  turn: TurnRecord;
  inProgress: boolean;
}

export class Charivo {
  private eventBus: EventBus;
  private llmManager?: LLMManager;
  private renderManager?: RenderManager;
  private ttsManager?: TTSManager;
  private sttManager?: STTManager;
  private realtimeManager?: import("./types").RealtimeManager;
  private character?: Character;
  private isRealtimeMode = false;
  private turnEpoch = 0;
  private activeTurn?: TurnRecord;
  private readonly turnQueue: TurnEntry[] = [];
  private messageSeq = 0;

  constructor() {
    this.eventBus = new EventBus();
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
   * Attach an LLM manager to handle conversation generation.
   * Automatically sets the current character if available.
   */
  attachLLM(manager: LLMManager): void {
    this.llmManager = manager;
    this.connectLLMManagerEventEmitter(manager);

    // Set character if it was already configured
    if (this.character) {
      manager.setCharacter(this.character);
    }
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
   * Detach the LLM manager to disable chat completions.
   */
  detachLLM(): void {
    this.llmManager = undefined;
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
   * Connects the LLM manager to the event bus for tool-call event emission.
   */
  private connectLLMManagerEventEmitter(manager: LLMManager): void {
    if (manager.setEventEmitter) {
      manager.setEventEmitter(this.eventBus);
    }
  }

  /**
   * Set the character for this Charivo instance.
   * Automatically propagates to all attached managers (LLM, Renderer).
   */
  setCharacter(character: Character): void {
    this.character = character;

    if (this.llmManager) {
      this.llmManager.setCharacter(character);
    }

    if (this.renderManager) {
      this.renderManager.setCharacter(character);
    }

    if (this.realtimeManager) {
      this.realtimeManager.setCharacter(character);
    }
  }

  /**
   * Ids are for observability only, so a timestamp plus a per-instance
   * counter is enough: same-millisecond turns no longer collide, which
   * matters because turn:cancelled names its turn by user message id.
   */
  private nextMessageId(): string {
    this.messageSeq += 1;
    return `${Date.now()}-${this.messageSeq}`;
  }

  /** A turn is live only while it is the newest one. */
  private isStale(turn: TurnRecord): boolean {
    return this.turnEpoch !== turn.epoch;
  }

  private removeQueueEntry(entry: TurnEntry): void {
    const index = this.turnQueue.indexOf(entry);
    if (index !== -1) {
      this.turnQueue.splice(index, 1);
    }
  }

  /**
   * Head-first drain shared by both flushes, so history order is call order at
   * any reentrancy depth. Both return immediately on an in-progress head.
   *
   * With `requester` null this is flush-superseded: it writes entries whose
   * owner is no longer the active turn, stops at the first entry the active
   * turn owns, and swallows rejections. With a requester it is flush-through:
   * it writes older entries first, then the requester's own entry, recording
   * that write's rollback handle and propagating a rejection of that entry
   * alone.
   */
  private writeQueuedEntries(
    manager: LLMManager,
    requester: TurnRecord | null,
  ): void {
    while (this.turnQueue.length > 0) {
      const head = this.turnQueue[0]!;

      if (head.inProgress) {
        return;
      }

      const isOwnEntry = head.turn === requester;
      if (!isOwnEntry && head.turn === this.activeTurn) {
        return;
      }

      head.inProgress = true;

      try {
        const handle = manager.addToHistory(head.message);
        this.removeQueueEntry(head);

        if (isOwnEntry) {
          head.turn.rollback = { manager, handle };
          return;
        }
      } catch (error) {
        this.removeQueueEntry(head);

        if (isOwnEntry) {
          throw error;
        }
      }
    }
  }

  /** Entry-block flush: drains the superseded backlog into the live manager. */
  private flushSupersededEntries(): void {
    if (!this.llmManager || !this.character) {
      return;
    }

    this.writeQueuedEntries(this.llmManager, null);
  }

  /**
   * Process a user message and generate a character response.
   * Orchestrates the full conversation flow: rendering, LLM generation, and TTS playback.
   *
   * Latest-wins: a newer call supersedes the in-flight turn, which then
   * resolves without performing any further turn-scoped effect or emitting
   * any further turn-scoped event. Its user message is retained regardless of
   * the phase the supersession lands in.
   */
  async userSay(content: string): Promise<void> {
    const userMessage: Message = {
      id: this.nextMessageId(),
      content,
      timestamp: new Date(),
      type: "user",
    };

    // message:sent now precedes the pre-turn stop, so an ambient re-read could
    // be redirected by one of its listeners. Stopping the manager attached
    // when userSay() was called keeps today's semantics; every later TTS read
    // stays ambient, so a mid-turn attach still governs playback.
    const entryTTSManager = this.ttsManager;

    this.turnEpoch += 1;
    const turn: TurnRecord = {
      epoch: this.turnEpoch,
      userMessageId: userMessage.id,
    };
    const superseded = this.activeTurn;
    this.activeTurn = turn;

    // The position is reserved before anything reentrant can run, so queue
    // order is call order and retention no longer depends on the phase.
    const entry: TurnEntry = { message: userMessage, turn, inProgress: false };
    this.turnQueue.push(entry);

    try {
      this.eventBus.emit("message:sent", { message: userMessage });

      this.flushSupersededEntries();

      if (superseded) {
        this.eventBus.emit("turn:cancelled", {
          userMessageId: superseded.userMessageId,
        });
      }

      if (this.isStale(turn)) {
        return;
      }

      // Stop any TTS still playing from the previous turn before the LLM can
      // project a new expression via a tool call (avatar:expression). Without
      // this, speak()'s own internal stop() would emit tts:audio:end for the
      // PRIOR utterance mid-turn, which RenderManager reads as the signal to
      // release the NEW expression before its own speech has even started.
      if (entryTTSManager) {
        try {
          await entryTTSManager.stop();
        } catch (error) {
          if (this.isStale(turn)) {
            return;
          }

          const typedError = toCharivoError("provider", error);
          this.eventBus.emit("tts:error", { error: typedError });
        }

        if (this.isStale(turn)) {
          return;
        }
      }

      // Render user message
      if (this.renderManager) {
        try {
          await this.renderManager.render(userMessage);
        } catch (error) {
          if (this.isStale(turn)) {
            return;
          }

          throw toCharivoError("state", error, "Failed to render user message");
        }

        if (this.isStale(turn)) {
          return;
        }
      }

      // Generate and render character response
      if (this.llmManager && this.character) {
        const generatingManager = this.llmManager;
        let response: string;

        try {
          // Nothing generates until the queue has reached this turn's own
          // entry: an older entry can be mid-write in a reentrant flush, and
          // this turn's prompt must contain every message ahead of it.
          for (;;) {
            this.writeQueuedEntries(generatingManager, turn);

            if (!this.turnQueue.includes(entry)) {
              break;
            }

            await Promise.resolve();

            if (this.isStale(turn)) {
              return;
            }
          }

          if (this.isStale(turn)) {
            return;
          }

          response = await generatingManager.generateResponse(userMessage, {
            callerOwnsHistory: true,
            isCancelled: () => this.isStale(turn),
          });
        } catch (error) {
          if (this.isStale(turn)) {
            return;
          }

          turn.rollback?.handle();
          throw toCharivoError(
            "provider",
            error,
            "Failed to generate a character response",
          );
        }

        if (this.isStale(turn)) {
          return;
        }

        const characterMessage: Message = {
          id: this.nextMessageId() + "_response",
          content: response,
          timestamp: new Date(),
          characterId: this.character.id,
          type: "character",
        };

        this.eventBus.emit("message:received", { message: characterMessage });

        if (this.isStale(turn)) {
          return;
        }

        this.eventBus.emit("character:speak", {
          character: this.character,
          text: response,
        });

        if (this.isStale(turn)) {
          return;
        }

        if (this.renderManager) {
          try {
            await this.renderManager.render(characterMessage, this.character);
          } catch (error) {
            if (this.isStale(turn)) {
              return;
            }

            throw toCharivoError(
              "state",
              error,
              "Failed to render character response",
            );
          }

          if (this.isStale(turn)) {
            return;
          }
        }

        // Presentation boundary: the reply enters history only once its still
        // live turn has rendered it and is about to play it, so a superseded
        // turn's unspoken reply is never committed. A presented reply is never
        // rolled back, so the handle is discarded.
        try {
          generatingManager.addToHistory(characterMessage);
        } catch (error) {
          if (this.isStale(turn)) {
            return;
          }

          throw toCharivoError(
            "provider",
            error,
            "Failed to generate a character response",
          );
        }

        if (this.isStale(turn)) {
          return;
        }

        if (this.ttsManager) {
          try {
            this.eventBus.emit("tts:start", {
              text: response,
              characterId: this.character.id,
            });

            if (this.isStale(turn)) {
              return;
            }

            const ttsOptions = this.character.voice
              ? {
                  rate: this.character.voice.rate,
                  pitch: this.character.voice.pitch,
                  volume: this.character.voice.volume,
                  voice: this.character.voice.voiceId,
                }
              : undefined;

            await this.ttsManager.speak(response, ttsOptions);

            if (this.isStale(turn)) {
              return;
            }

            this.eventBus.emit("tts:end", { characterId: this.character.id });
          } catch (error) {
            if (this.isStale(turn)) {
              return;
            }

            const typedError = toCharivoError("provider", error);
            this.eventBus.emit("tts:error", { error: typedError });
          }
        }
      }
    } finally {
      // A turn that was never superseded leaves nothing behind: it either
      // wrote its message itself or never reached a manager at all.
      if (!this.isStale(turn)) {
        this.removeQueueEntry(entry);
        this.activeTurn = undefined;
      }
    }
  }

  /**
   * Clear the conversation history from the LLM manager.
   */
  clearHistory(): void {
    if (this.llmManager) {
      this.llmManager.clearHistory();
    }
  }

  /**
   * Get the conversation history from the LLM manager.
   */
  getHistory(): Message[] {
    return this.llmManager ? this.llmManager.getHistory() : [];
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
   * Attach a Realtime manager to handle real-time conversation.
   * Automatically connects the event emitter and enables Realtime mode.
   */
  attachRealtime(manager: import("./types").RealtimeManager): void {
    this.realtimeManager = manager;
    this.isRealtimeMode = true;
    this.connectRealtimeManagerEventEmitter(manager);

    if (this.character) {
      manager.setCharacter(this.character);
    }
  }

  /**
   * Detach the Realtime manager and disable Realtime mode.
   */
  detachRealtime(): void {
    this.realtimeManager = undefined;
    this.isRealtimeMode = false;
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

    if (this.realtimeManager) {
      try {
        await this.realtimeManager.stopSession();
      } catch (error) {
        recordError(error, "Failed to stop realtime session during dispose");
      }
    }

    if (this.ttsManager) {
      try {
        await this.ttsManager.stop();
      } catch (error) {
        recordError(error, "Failed to stop TTS during dispose");
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

    if (this.llmManager) {
      try {
        this.llmManager.clearHistory();
      } catch (error) {
        recordError(error, "Failed to clear LLM history during dispose");
      }
    }

    this.detachRealtime();
    this.detachTTS();
    this.detachSTT();
    this.detachLLM();
    // renderManager was already destroyed+disconnected in the guarded block above;
    // bypass detachRenderer() here to avoid a second disconnect() call.
    this.renderManager = undefined;
    this.character = undefined;
    this.isRealtimeMode = false;
    this.turnQueue.length = 0;
    this.eventBus.clear();

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
 * modality is attached only when supplied.
 */
export interface CharivoOptions {
  llm?: LLMManager;
  tts?: TTSManager;
  stt?: STTManager;
  realtime?: RealtimeManager;
  renderer?: RenderManager;
  character?: Character;
}

/**
 * Create a Charivo instance with its managers already attached.
 *
 * Equivalent to `new Charivo()` followed by the matching `attach*` calls, then
 * `setCharacter()`. The character is applied last so it reaches every manager
 * supplied above it; hand-wiring works in either order only because `attach*`
 * re-applies an already-set character, and that coupling is easy to miss.
 *
 * Note that supplying `realtime` also enables realtime mode, exactly as
 * `attachRealtime()` does.
 */
export function createCharivo(options: CharivoOptions = {}): Charivo {
  const charivo = new Charivo();

  if (options.renderer) {
    charivo.attachRenderer(options.renderer);
  }

  if (options.llm) {
    charivo.attachLLM(options.llm);
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

  if (options.character) {
    charivo.setCharacter(options.character);
  }

  return charivo;
}
