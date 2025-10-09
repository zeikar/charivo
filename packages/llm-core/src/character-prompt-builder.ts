import { Character } from "@charivo/core";

/**
 * 캐릭터 정보를 시스템 프롬프트로 변환하는 유틸리티
 */
export class CharacterPromptBuilder {
  static buildSystemPrompt(character: Character): string {
    const name = character.name;
    const description = character.description || "";
    const personality = character.personality || "";

    // Add emotion tag instructions
    const emotionInstruction = this.buildEmotionInstruction();

    return `You are ${name}. ${description} ${personality}

${emotionInstruction}`.trim();
  }

  static buildSystemPromptOrDefault(character?: Character): string {
    if (character) {
      return this.buildSystemPrompt(character);
    }
    return `You are a helpful assistant.

${this.buildEmotionInstruction()}`.trim();
  }

  /**
   * Build emotion tag usage instruction
   */
  private static buildEmotionInstruction(): string {
    const emotionList = [
      "happy",
      "sad",
      "angry",
      "surprised",
      "thinking",
      "excited",
      "shy",
      "neutral",
    ].join(", ");

    return `IMPORTANT: You can express emotions by adding emotion tags in your responses.
Available emotion tags: ${emotionList}
Use format: [emotion] anywhere in your response.
Examples:
- "Hello! [happy] Nice to meet you!"
- "I'm sorry... [sad]"
- "Wow! [surprised] That's amazing!"
- "Hmm... [thinking] Let me think about it."

The emotion tag will control your facial expression and body motion. Use them naturally to enhance your responses.`;
  }
}
