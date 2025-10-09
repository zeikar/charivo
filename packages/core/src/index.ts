import { EventBus } from "./bus";
import {
  Character,
  Message,
  RenderManager,
  TTSManager,
  LLMManager,
} from "./types";
import { parseEmotion } from "./emotion-parser";

export * from "./types";
export * from "./bus";
export * from "./emotion-parser";

export class Charivo {
  private eventBus: EventBus;
  private llmManager?: LLMManager;
  private renderManager?: RenderManager;
  private ttsManager?: TTSManager;
  private character?: Character;

  constructor() {
    this.eventBus = new EventBus();
  }

  /**
   * Attach a render manager to handle character visualization.
   * Automatically connects the event bus and sets the current character if available.
   */
  attachRenderer(renderManager: RenderManager): void {
    console.log(
      "🎭 Charivo: Attaching render manager",
      renderManager.constructor.name,
    );
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
    if (
      "setEventBus" in renderManager &&
      typeof renderManager.setEventBus === "function"
    ) {
      console.log(
        "🔗 Charivo: ✅ Render manager supports event bus - connecting",
      );
      (renderManager as any).setEventBus({
        on: (event: string, callback: (...args: any[]) => void) => {
          console.log(
            `🔗 Charivo: Render manager subscribing to event: ${event}`,
          );
          this.eventBus.on(event as any, callback as any);
        },
        emit: (event: string, data: any) => {
          console.log(
            `🔗 Charivo: Render manager emitting event: ${event}`,
            data,
          );
          this.eventBus.emit(event as any, data);
        },
      });
      console.log("🔗 Charivo: Event bus connection completed");
    } else {
      console.warn(
        "⚠️ Charivo: Render manager doesn't support event bus connection",
        {
          hasSetEventBus: "setEventBus" in renderManager,
          setEventBusType: typeof (renderManager as any).setEventBus,
        },
      );
    }
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
    console.log("🔊 Charivo: Attaching TTS manager", manager.constructor.name);
    this.ttsManager = manager;

    this.connectTTSManagerEventEmitter(manager);
  }

  /**
   * Detach the TTS manager to disable voice synthesis.
   */
  detachTTS(): void {
    console.log("🔇 Charivo: Detaching TTS manager");
    this.ttsManager = undefined;
  }

  /**
   * Connects the TTS manager to the event bus for audio event emission.
   */
  private connectTTSManagerEventEmitter(manager: TTSManager): void {
    if (manager.setEventEmitter) {
      console.log(
        "🔗 Charivo: ✅ TTS manager supports event emitter - connecting",
      );
      manager.setEventEmitter({
        emit: (event: string, data: any) => {
          console.log(`🎵 Charivo: ✅ TTS EMITTING EVENT: ${event}`, data);
          this.eventBus.emit(event as any, data);
          console.log(`🎵 Charivo: ✅ Event ${event} emitted to event bus`);
        },
      });
      console.log("🔗 Charivo: TTS Manager connection completed");
    } else {
      console.warn("⚠️ Charivo: TTS manager doesn't support event emitter", {
        managerType: manager.constructor.name,
      });
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
      await this.renderManager.render(userMessage);
    }

    // Generate and render character response
    if (this.llmManager && this.character) {
      const response = await this.llmManager.generateResponse(userMessage);

      // Parse emotion tags from response
      const parsed = parseEmotion(response);

      const characterMessage: Message = {
        id: Date.now().toString() + "_response",
        content: parsed.text, // Use cleaned text without emotion tags
        timestamp: new Date(),
        characterId: this.character.id,
        type: "character",
        emotion: parsed.emotion, // Add parsed emotion
      };

      this.eventBus.emit("message:received", { message: characterMessage });
      this.eventBus.emit("character:speak", {
        character: this.character,
        message: parsed.text,
      });

      if (this.renderManager) {
        await this.renderManager.render(characterMessage, this.character);
      }

      // Play character voice with TTS (using cleaned text)
      if (this.ttsManager) {
        try {
          this.eventBus.emit("tts:start", {
            text: parsed.text,
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

          await this.ttsManager.speak(parsed.text, ttsOptions);
          this.eventBus.emit("tts:end", { characterId: this.character.id });
        } catch (error) {
          this.eventBus.emit("tts:error", { error: error as Error });
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
   * Subscribe to events from the event bus.
   */
  on<K extends keyof import("./types").EventMap>(
    event: K,
    listener: (data: import("./types").EventMap[K]) => void,
  ): void {
    this.eventBus.on(event, listener);
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
}
