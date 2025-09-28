import { Character, Message, Renderer, TTSPlayer, LLMManager } from "./types";
export * from "./types";
export * from "./bus";
export declare class Charivo {
  private eventBus;
  private llmManager?;
  private renderer?;
  private ttsAdapter?;
  private characters;
  constructor();
  attachRenderer(renderer: Renderer): void;
  attachLLM(manager: LLMManager): void;
  attachTTS(adapter: TTSPlayer): void;
  addCharacter(character: Character): void;
  userSay(content: string, characterId?: string): Promise<void>;
  /**
   * LLM Manager 관련 편의 메소드들
   */
  clearHistory(): void;
  getHistory(): Message[];
  getCurrentCharacter(): Character | null;
  on<K extends keyof import("./types").EventMap>(
    event: K,
    listener: (data: import("./types").EventMap[K]) => void,
  ): void;
  emit<K extends keyof import("./types").EventMap>(
    event: K,
    data: import("./types").EventMap[K],
  ): void;
}
//# sourceMappingURL=index.d.ts.map
