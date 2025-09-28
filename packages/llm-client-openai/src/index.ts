import { LLMClient } from "@charivo/core";
import {
  createOpenAILLMProvider,
  OpenAILLMConfig,
  OpenAILLMProvider,
} from "@charivo/llm-provider-openai";

// OpenAILLMConfig를 직접 사용
export type OpenAILLMClientConfig = OpenAILLMConfig;

/**
 * OpenAI LLM Client - OpenAI provider를 래핑해서 클라이언트에서 직접 사용하는 Stateless 클라이언트
 *
 * 로컬 개발이나 테스트 환경에서 사용. 프로덕션에서는 보안상 권장하지 않음.
 * API 키가 클라이언트에 노출되므로 서버 환경에서만 사용하거나 테스트용으로만 사용해야 함.
 *
 * Stateless 설계: 세션 관리는 외부에서 담당하고, 이 클라이언트는 API 호출만 담당
 */
export class OpenAILLMClient implements LLMClient {
  private provider: OpenAILLMProvider;

  constructor(config: OpenAILLMClientConfig) {
    // 브라우저에서 사용하기 위해 dangerouslyAllowBrowser를 자동으로 true로 설정
    this.provider = createOpenAILLMProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
  }

  async call(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    // Provider를 사용해서 응답 생성
    const assistantMessage = await this.provider.generateResponse(messages);

    return assistantMessage;
  }
}

export function createOpenAILLMClient(
  config: OpenAILLMClientConfig,
): OpenAILLMClient {
  return new OpenAILLMClient(config);
}
