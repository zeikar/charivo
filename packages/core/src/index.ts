import { EventBus } from "./bus";
import {
  Character,
  Message,
  RenderManager,
  TTSManager,
  STTManager,
  LLMManager,
} from "./types";
import { toCharivoError, type CharivoError } from "./errors";

export * from "./types";
export * from "./bus";
export * from "./browser-lifecycle";
export * from "./errors";

export class Charivo {
  private eventBus: EventBus;
  private llmManager?: LLMManager;
  private renderManager?: RenderManager;
  private ttsManager?: TTSManager;
  private sttManager?: STTManager;
  private realtimeManager?: import("./types").RealtimeManager;
  private character?: Character;
  private isRealtimeMode = false;

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
   * Process a user message and generate a character response.
   * Orchestrates the full conversation flow: rendering, LLM generation, and TTS playback.
   */
  async userSay(content: string): Promise<void> {
    const userMessage: Message = {
      id: Date.now().toString(),
      content,
      timestamp: new Date(),
      type: "user",
    };

    this.eventBus.emit("message:sent", { message: userMessage });

    // Render user message
    if (this.renderManager) {
      try {
        await this.renderManager.render(userMessage);
      } catch (error) {
        throw toCharivoError("state", error, "Failed to render user message");
      }
    }

    // Generate and render character response
    if (this.llmManager && this.character) {
      const response = await this.llmManager
        .generateResponse(userMessage)
        .catch((error) =>
          Promise.reject(
            toCharivoError(
              "provider",
              error,
              "Failed to generate a character response",
            ),
          ),
        );

      const characterMessage: Message = {
        id: Date.now().toString() + "_response",
        content: response,
        timestamp: new Date(),
        characterId: this.character.id,
        type: "character",
      };

      this.eventBus.emit("message:received", { message: characterMessage });
      this.eventBus.emit("character:speak", {
        character: this.character,
        message: response,
      });

      if (this.renderManager) {
        try {
          await this.renderManager.render(characterMessage, this.character);
        } catch (error) {
          throw toCharivoError(
            "state",
            error,
            "Failed to render character response",
          );
        }
      }

      if (this.ttsManager) {
        try {
          this.eventBus.emit("tts:start", {
            text: response,
            characterId: this.character.id,
          });

          const ttsOptions = this.character.voice
            ? {
                rate: this.character.voice.rate,
                pitch: this.character.voice.pitch,
                volume: this.character.voice.volume,
                voice: this.character.voice.voiceId,
              }
            : undefined;

          await this.ttsManager.speak(response, ttsOptions);
          this.eventBus.emit("tts:end", { characterId: this.character.id });
        } catch (error) {
          const typedError = toCharivoError("provider", error);
          this.eventBus.emit("tts:error", { error: typedError });
        }
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
    this.eventBus.clear();

    return this.finishDispose(firstError);
  }

  private finishDispose(firstError: CharivoError | null): void {
    if (firstError) {
      throw firstError;
    }
  }
}
