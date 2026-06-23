import { LLMClient } from "@charivo/core";
import {
  createOpenClawLLMProvider,
  OpenClawLLMConfig,
  OpenClawLLMProvider,
} from "./provider";

// Use OpenClawLLMConfig directly
export type OpenClawLLMClientConfig = OpenClawLLMConfig;

/**
 * OpenClaw LLM Client - Stateless client that wraps the OpenClaw provider for direct use on the client
 *
 * For use in local development or test environments. Not recommended for production for security reasons.
 * The token is exposed to the client, so use it only in a server environment or for testing purposes.
 *
 * Stateless design: session management is handled externally, and this client only handles API calls
 */
export class OpenClawLLMClient implements LLMClient {
  private provider: OpenClawLLMProvider;

  constructor(config: OpenClawLLMClientConfig) {
    // Intentional dev/test escape hatch: this direct browser client exposes
    // credentials. For production, see docs/guide/choosing-packages.md#remote.
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
