import { Message } from "@charivo/core";

/**
 * 메시지 형식 변환 유틸리티
 */
export class MessageConverter {
  /**
   * Charivo Message를 OpenAI 형식으로 변환
   */
  static toOpenAIFormat(
    messages: Message[],
  ): Array<{ role: string; content: string }> {
    return messages.map((msg) => ({
      role: msg.type === "user" ? "user" : "assistant",
      content: msg.content,
    }));
  }

  /**
   * 시스템 프롬프트와 메시지들을 OpenAI 형식으로 결합
   */
  static combineWithSystemPrompt(
    systemPrompt: string,
    messages: Message[],
  ): Array<{ role: string; content: string }> {
    return [
      { role: "system", content: systemPrompt },
      ...this.toOpenAIFormat(messages),
    ];
  }
}
