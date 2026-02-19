import { LLMClient } from "@charivo/core";
import {
  createOpenClawLLMProvider,
  OpenClawLLMConfig,
  OpenClawLLMProvider,
} from "@charivo/llm-provider-openclaw";

// OpenClawLLMConfig를 직접 사용
export type OpenClawLLMClientConfig = OpenClawLLMConfig;

/**
 * OpenClaw LLM Client - OpenClaw provider를 래핑해서 클라이언트에서 직접 사용하는 Stateless 클라이언트
 *
 * 로컬 개발이나 테스트 환경에서 사용. 프로덕션에서는 보안상 권장하지 않음.
 * 토큰이 클라이언트에 노출되므로 서버 환경에서만 사용하거나 테스트용으로만 사용해야 함.
 *
 * Stateless 설계: 세션 관리는 외부에서 담당하고, 이 클라이언트는 API 호출만 담당
 */
export class OpenClawLLMClient implements LLMClient {
  private provider: OpenClawLLMProvider;

  constructor(config: OpenClawLLMClientConfig) {
    // 브라우저에서 사용하기 위해 dangerouslyAllowBrowser를 자동으로 true로 설정
    this.provider = createOpenClawLLMProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
  }

  async call(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    return this.provider.generateResponse(messages);
  }
}

export function createOpenClawLLMClient(
  config: OpenClawLLMClientConfig,
): OpenClawLLMClient {
  return new OpenClawLLMClient(config);
}
