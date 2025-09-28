import { Message } from "@charivo/core";

/**
 * AI 응답 메시지 생성 헬퍼
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
