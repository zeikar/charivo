import { Message } from "@charivo/core";

/**
 * Converted message shape. The role is a literal union so the result is also
 * assignable to the tool-calling `LLMMessage` union without casts.
 */
export interface LLMApiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Message format conversion utility
 */
export class MessageConverter {
  /**
   * Convert a Charivo Message to the OpenAI format
   */
  static toOpenAIFormat(messages: Message[]): LLMApiMessage[] {
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
  ): LLMApiMessage[] {
    return [
      { role: "system", content: systemPrompt },
      ...this.toOpenAIFormat(messages),
    ];
  }
}
