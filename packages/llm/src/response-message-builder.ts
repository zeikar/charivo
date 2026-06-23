import { Message } from "@charivo/core";

/**
 * Helper for building AI response messages
 */
export class ResponseMessageBuilder {
  static create(
    content: string,
    characterId: string,
    messageId?: string,
  ): Message {
    return {
      id: messageId || "ai-" + Date.now(),
      content,
      timestamp: new Date(),
      type: "character",
      characterId,
    };
  }
}
