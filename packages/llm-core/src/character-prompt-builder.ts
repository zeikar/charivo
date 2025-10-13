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

    return `IMPORTANT: Express emotions using ONLY the following emotion tags:
Available tags: ${emotionList}

STRICT RULES:
1. Use EXACTLY ONE emotion tag per response
2. Format: [emotion] - single word only, no spaces, no commas, no extra text
3. Place the tag at the END of your response
4. Use ONLY English emotion words from the available list above

CORRECT examples:
- "Hello! Nice to meet you! [happy]"
- "I'm sorry... [sad]"
- "Wow! That's amazing! [surprised]"
- "Hmm... Let me think about it. [thinking]"

WRONG examples (DO NOT use these formats):
- "[happy, smiling]" ❌ (no commas or multiple words)
- "[행복]" ❌ (no Korean or non-English text)
- "[shy, 살짝 미소]" ❌ (no mixed languages)
- "[happy] [sad]" ❌ (only one tag per response)

The emotion tag controls your facial expression and body motion. Use it naturally to enhance your response.`;
  }
}
