import type {
  LLMClient,
  LLMMessage,
  LLMToolResponse,
  ToolDefinition,
} from "@charivo/core";
import {
  createGeminiLLMProvider,
  GeminiLLMConfig,
  GeminiLLMProvider,
} from "./provider";

export {
  createGeminiLLMProvider,
  GeminiLLMProvider,
  type GeminiLLMConfig,
} from "./provider";

// Use GeminiLLMConfig directly
export type GeminiLLMClientConfig = GeminiLLMConfig;

/**
 * Gemini LLM Client - Stateless client that wraps the Gemini provider for direct use on the client
 *
 * For use in local development or test environments. Not recommended for production for security reasons.
 * The API key is exposed to the client, so use it only in a server environment or for testing purposes.
 *
 * Stateless design: session management is handled externally, and this client only handles API calls
 */
class GeminiLLMClient implements LLMClient {
  private provider: GeminiLLMProvider;

  constructor(config: GeminiLLMClientConfig) {
    // Intentional dev/test escape hatch: this direct browser client exposes
    // credentials. For production, see docs/guide/choosing-packages.md#remote.
    this.provider = createGeminiLLMProvider({
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

  async callWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMToolResponse> {
    return this.provider.generateResponseWithTools(messages, tools);
  }
}

export function createGeminiLLMClient(
  config: GeminiLLMClientConfig,
): LLMClient {
  return new GeminiLLMClient(config);
}
