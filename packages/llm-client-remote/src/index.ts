import type {
  Message,
  Character,
  LLMAdapter as CoreLLMAdapter,
} from "@charivo/core";

export interface RemoteLLMConfig {
  apiEndpoint?: string;
}

export class RemoteLLMClient implements CoreLLMAdapter {
  private apiEndpoint: string;
  private character: Character | null = null;
  private messageHistory: Message[] = [];

  constructor(config: RemoteLLMConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/chat";
  }

  setCharacter(character: Character): void {
    this.character = character;
    // 캐릭터가 바뀌면 히스토리도 초기화
    this.messageHistory = [];
  }

  clearHistory(): void {
    this.messageHistory = [];
  }

  async generateResponse(message: Message): Promise<string> {
    if (!this.character) {
      throw new Error("Character must be set before generating response");
    }

    // 새 메시지를 히스토리에 추가
    this.messageHistory.push(message);

    // 시스템 프롬프트 생성
    const systemPrompt = `You are ${this.character.name}. ${this.character.description || ""} ${this.character.personality || ""}`;

    // OpenAI 메시지 형식으로 변환
    const openAIMessages = [
      { role: "system" as const, content: systemPrompt },
      ...this.messageHistory.map((msg) => ({
        role: msg.type === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.content,
      })),
    ];

    try {
      const response = await fetch(this.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: openAIMessages,
        }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(
          `API call failed: ${errorData.error || response.statusText}`,
        );
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to generate response");
      }

      const assistantMessage = data.message || "";

      // AI 응답도 히스토리에 추가
      const responseMessage: Message = {
        id: "ai-" + Date.now(),
        content: assistantMessage,
        timestamp: new Date(),
        type: "character",
        characterId: this.character.id,
      };
      this.messageHistory.push(responseMessage);

      return assistantMessage;
    } catch (error) {
      console.error("OpenAI Adapter Error:", error);
      // 에러가 발생하면 마지막 메시지를 히스토리에서 제거
      this.messageHistory.pop();
      throw error;
    }
  }
}

export function createRemoteLLMClient(
  config?: RemoteLLMConfig,
): RemoteLLMClient {
  return new RemoteLLMClient(config);
}
