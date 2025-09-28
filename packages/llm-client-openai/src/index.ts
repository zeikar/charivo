import { LLMAdapter, Message, Character } from "@charivo/core";
import {
  createOpenAILLMProvider,
  OpenAILLMConfig,
  OpenAILLMProvider,
} from "@charivo/llm-provider-openai";

// OpenAILLMConfig를 직접 사용
export type OpenAILLMClientConfig = OpenAILLMConfig;

/**
 * OpenAI LLM Client - OpenAI provider를 래핑해서 클라이언트에서 직접 사용하는 클라이언트
 *
 * 로컬 개발이나 테스트 환경에서 사용. 프로덕션에서는 보안상 권장하지 않음.
 * API 키가 클라이언트에 노출되므로 서버 환경에서만 사용하거나 테스트용으로만 사용해야 함.
 */
export class OpenAILLMClient implements LLMAdapter {
  private provider: OpenAILLMProvider;
  private character: Character | null = null;
  private messageHistory: Message[] = [];

  constructor(config: OpenAILLMClientConfig) {
    // 브라우저에서 사용하기 위해 dangerouslyAllowBrowser를 자동으로 true로 설정
    this.provider = createOpenAILLMProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
  }

  setCharacter(character: Character): void {
    this.character = character;
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

    // OpenAI 메시지 형식으로 변환
    const openAIMessages = this.messageHistory.map((msg) => ({
      role: msg.type === "user" ? "user" : "assistant",
      content: msg.content,
    }));

    try {
      // Provider를 사용해서 응답 생성
      const assistantMessage = await this.provider.generateResponse(
        openAIMessages,
        this.character,
      );

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
      console.error("OpenAI LLM Client Error:", error);
      // 에러가 발생하면 마지막 메시지를 히스토리에서 제거
      this.messageHistory.pop();
      throw error;
    }
  }
}

export function createOpenAILLMClient(
  config: OpenAILLMClientConfig,
): OpenAILLMClient {
  return new OpenAILLMClient(config);
}
