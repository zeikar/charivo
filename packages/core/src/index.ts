import { EventBus } from "./bus";
import {
  Character,
  Message,
  RenderManager,
  TTSManager,
  LLMManager,
} from "./types";

export * from "./types";
export * from "./bus";

export class Charivo {
  private eventBus: EventBus;
  private llmManager?: LLMManager;
  private renderManager?: RenderManager;
  private ttsManager?: TTSManager;
  private characters: Map<string, Character> = new Map();

  constructor() {
    this.eventBus = new EventBus();
  }

  attachRenderer(renderManager: RenderManager): void {
    console.log(
      "🎭 Charivo: Attaching render manager",
      renderManager.constructor.name,
    );
    this.renderManager = renderManager;

    // Set up event bus connection if render manager supports it
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

  attachLLM(manager: LLMManager): void {
    this.llmManager = manager;
  }

  attachTTS(manager: TTSManager): void {
    console.log("🔊 Charivo: Attaching TTS manager", manager.constructor.name);
    this.ttsManager = manager;

    // Connect event emitter if TTS manager supports it
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

  addCharacter(character: Character): void {
    this.characters.set(character.id, character);

    // LLM Manager에 캐릭터 설정 (만약 한 명의 캐릭터만 사용하는 경우)
    if (this.llmManager) {
      this.llmManager.setCharacter(character);
    }
  }

  async userSay(content: string, characterId?: string): Promise<void> {
    const userMessage: Message = {
      id: Date.now().toString(),
      content,
      timestamp: new Date(),
      type: "user",
    };

    this.eventBus.emit("message:sent", { message: userMessage });

    if (this.renderManager) {
      await this.renderManager.render(userMessage);
    }

    if (this.llmManager && characterId) {
      const character = this.characters.get(characterId);
      if (character) {
        // LLM Manager에 캐릭터 설정 (만약 여러 캐릭터를 사용하는 경우)
        this.llmManager.setCharacter(character);

        const response = await this.llmManager.generateResponse(userMessage);

        const characterMessage: Message = {
          id: Date.now().toString() + "_response",
          content: response,
          timestamp: new Date(),
          characterId,
          type: "character",
        };

        this.eventBus.emit("message:received", { message: characterMessage });
        this.eventBus.emit("character:speak", { character, message: response });

        if (this.renderManager) {
          await this.renderManager.render(characterMessage, character);
        }

        // TTS로 음성 출력
        if (this.ttsManager) {
          try {
            this.eventBus.emit("tts:start", { text: response, characterId });

            const ttsOptions = character.voice
              ? {
                  rate: character.voice.rate,
                  pitch: character.voice.pitch,
                  volume: character.voice.volume,
                  voice: character.voice.voiceId,
                }
              : undefined;

            await this.ttsManager.speak(response, ttsOptions);
            this.eventBus.emit("tts:end", { characterId });
          } catch (error) {
            this.eventBus.emit("tts:error", { error: error as Error });
          }
        }
      }
    }
  }

  /**
   * LLM Manager 관련 편의 메소드들
   */
  clearHistory(): void {
    if (this.llmManager) {
      this.llmManager.clearHistory();
    }
  }

  getHistory(): Message[] {
    return this.llmManager ? this.llmManager.getHistory() : [];
  }

  getCurrentCharacter(): Character | null {
    return this.llmManager ? this.llmManager.getCharacter() : null;
  }

  on<K extends keyof import("./types").EventMap>(
    event: K,
    listener: (data: import("./types").EventMap[K]) => void,
  ): void {
    this.eventBus.on(event, listener);
  }

  emit<K extends keyof import("./types").EventMap>(
    event: K,
    data: import("./types").EventMap[K],
  ): void {
    this.eventBus.emit(event, data);
  }
}
