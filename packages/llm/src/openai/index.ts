import type { LLMClient } from "@charivo/core";
import {
  createOpenAILLMProvider,
  OpenAILLMConfig,
  OpenAILLMProvider,
} from "./provider";

// Use OpenAILLMConfig directly
export type OpenAILLMClientConfig = OpenAILLMConfig;

/**
 * OpenAI LLM Client - Stateless client that wraps the OpenAI provider for direct use on the client
 *
 * For use in local development or test environments. Not recommended for production for security reasons.
 * The API key is exposed to the client, so use it only in a server environment or for testing purposes.
 *
 * Stateless design: session management is handled externally, and this client only handles API calls
 */
class OpenAILLMClient implements LLMClient {
  private provider: OpenAILLMProvider;

  constructor(config: OpenAILLMClientConfig) {
    // Intentional dev/test escape hatch: this direct browser client exposes
    // credentials. For production, see docs/guide/choosing-packages.md#remote.
    this.provider = createOpenAILLMProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
  }

  async call(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    // Generate a response using the provider
    const assistantMessage = await this.provider.generateResponse(messages);

    return assistantMessage;
  }
}

export function createOpenAILLMClient(
  config: OpenAILLMClientConfig,
): LLMClient {
  return new OpenAILLMClient(config);
}
