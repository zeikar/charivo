import { LLMClient } from "@charivo/core";

/**
 * Stub LLM Client - Stateless client for testing
 *
 * Returns predefined responses in rotation without making real API calls
 * Used in development and testing environments
 */
export class StubLLMClient implements LLMClient {
  private responses: string[] = [
    "Hello! I'm a test character.",
    "The weather is really nice today!",
    "How can I help you?",
    "That's an interesting question. Could you tell me more?",
    "Yes, understood!",
    "I see. That's an interesting story.",
    "I think so too.",
    "Hmm... that's a difficult question.",
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
