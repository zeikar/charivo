import { EventBus } from "./bus";
import { Character, Message, Renderer, TTSPlayer, LLMManager } from "./types";

export * from "./types";
export * from "./bus";

export class Charivo {
  private eventBus: EventBus;
  private llmManager?: LLMManager;
  private renderer?: Renderer;
  private ttsAdapter?: TTSPlayer;
  private characters: Map<string, Character> = new Map();

  constructor() {
    this.eventBus = new EventBus();
  }

  attachRenderer(renderer: Renderer): void {
    this.renderer = renderer;
  }

  attachLLM(manager: LLMManager): void {
    this.llmManager = manager;
  }

  attachTTS(adapter: TTSPlayer): void {
    this.ttsAdapter = adapter;
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

    if (this.renderer) {
      await this.renderer.render(userMessage);
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

        if (this.renderer) {
          await this.renderer.render(characterMessage, character);
        }

        // TTS로 음성 출력
        if (this.ttsAdapter) {
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

            await this.ttsAdapter.speak(response, ttsOptions);
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
