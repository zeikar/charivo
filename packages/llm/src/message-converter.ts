import { Message } from "@charivo/core";

/**
 * Message format conversion utility
 */
export class MessageConverter {
  /**
   * Convert a Charivo Message to the OpenAI format
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
   * Combine the system prompt and messages into the OpenAI format
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
