import { LLMClient } from "@charivo/core";

/**
 * Stub LLM Client - Stateless client for testing
 *
 * Returns predefined responses in rotation without making real API calls
 * Used in development and testing environments
 */
export class StubLLMClient implements LLMClient {
  private responses: string[] = [
    "Hello! [happy] I'm a test character.",
    "The weather is really nice today! [excited]",
    "How can I help you? [neutral]",
    "[thinking] That's an interesting question. Could you tell me more?",
    "Yes, understood! [happy]",
    "I see. [neutral] That's an interesting story.",
    "I think so too. [happy]",
    "Hmm... [thinking] that's a difficult question.",
    "Oh no... [sad] I'm sorry to hear that.",
    "What?! [surprised] Really?",
    "That makes me upset. [angry]",
    "I'm a bit embarrassed... [shy]",
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
