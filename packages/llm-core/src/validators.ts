import { Character, Message } from "@charivo/core";

/**
 * LLM 관련 검증 유틸리티
 */
export class LLMValidators {
  static validateCharacterSet(
    character: Character | null,
  ): asserts character is Character {
    if (!character) {
      throw new Error("Character must be set before generating response");
    }
  }

  static validateMessage(message: Message): void {
    if (!message.content || typeof message.content !== "string") {
      throw new Error("Message content must be a non-empty string");
    }
  }
}
