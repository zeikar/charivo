import type { LLMClient } from "@charivo/core";

export interface RemoteLLMConfig {
  apiEndpoint?: string;
}

/**
 * Remote LLM Client - 서버 API를 호출하는 stateless 클라이언트
 */
export class RemoteLLMClient implements LLMClient {
  private apiEndpoint: string;

  constructor(config: RemoteLLMConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/chat";
  }

  async call(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    try {
      const response = await fetch(this.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
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

      return data.message || "";
    } catch (error) {
      console.error("Remote LLM Client Error:", error);
      throw error;
    }
  }
}

export function createRemoteLLMClient(
  config?: RemoteLLMConfig,
): RemoteLLMClient {
  return new RemoteLLMClient(config);
}
