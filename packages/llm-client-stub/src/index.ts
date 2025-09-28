import { LLMClient } from "@charivo/core";

/**
 * Stub LLM Client - 테스트용 Stateless 클라이언트
 *
 * 실제 API 호출 없이 미리 정의된 응답을 순환하며 반환
 * 개발 및 테스트 환경에서 사용
 */
export class StubLLMClient implements LLMClient {
  private responses: string[] = [
    "안녕하세요! 저는 테스트용 캐릭터입니다.",
    "오늘 날씨가 정말 좋네요!",
    "무엇을 도와드릴까요?",
    "흥미로운 질문이네요. 더 자세히 알려주실 수 있나요?",
    "네, 알겠습니다!",
    "그렇군요. 재미있는 이야기네요.",
    "저도 그렇게 생각해요.",
    "음... 그건 어려운 질문이네요.",
  ];

  private responseIndex = 0;

  async call(
    _messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    // 실제 API 호출을 시뮬레이션하기 위한 딜레이
    await new Promise((resolve) => setTimeout(resolve, 500));

    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;

    return response;
  }
}

export function createStubLLMClient(): StubLLMClient {
  return new StubLLMClient();
}
