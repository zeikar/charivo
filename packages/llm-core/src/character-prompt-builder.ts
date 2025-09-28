import { Character } from "@charivo/core";

/**
 * 캐릭터 정보를 시스템 프롬프트로 변환하는 유틸리티
 */
export class CharacterPromptBuilder {
  static buildSystemPrompt(character: Character): string {
    const name = character.name;
    const description = character.description || "";
    const personality = character.personality || "";

    return `You are ${name}. ${description} ${personality}`.trim();
  }

  static buildSystemPromptOrDefault(character?: Character): string {
    if (character) {
      return this.buildSystemPrompt(character);
    }
    return "You are a helpful assistant.";
  }
}
