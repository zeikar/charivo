import { Character } from "@charivo/core";

/**
 * Utility for converting character information into a system prompt
 */
export class CharacterPromptBuilder {
  static buildSystemPrompt(character: Character): string {
    const name = character.name;
    const description = character.description || "";
    const personality = character.personality || "";

    return `You are ${name}. ${description} ${personality}

Respond naturally in plain text with no bracketed emotion tags or control markup.`.trim();
  }

  static buildSystemPromptOrDefault(character?: Character): string {
    if (character) {
      return this.buildSystemPrompt(character);
    }
    return `You are a helpful assistant.

Respond naturally in plain text with no bracketed emotion tags or control markup.`.trim();
  }
}
