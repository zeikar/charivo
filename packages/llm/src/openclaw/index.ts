import type { LLMClient } from "@charivo/core";
import {
  createOpenClawLLMProvider,
  OpenClawLLMConfig,
  OpenClawLLMProvider,
} from "./provider";

export {
  createOpenClawLLMProvider,
  OpenClawLLMProvider,
  type OpenClawLLMConfig,
} from "./provider";

// No `sessionKey` here, unlike the provider config. Pinning the gateway
// session requires rotating it on reset, and this client is driven by
// LLMManager, whose clearHistory()/character switch clear only local history and
// cannot reach the client. A pinned session would survive that reset and silently
// replay the old conversation. Server routes construct the provider themselves and
// can rotate the key, so the option lives there instead.
export type OpenClawLLMClientConfig = Omit<OpenClawLLMConfig, "sessionKey">;

/**
 * OpenClaw LLM Client - Stateless client that wraps the OpenClaw provider for direct use on the client
 *
 * For use in local development or test environments. Not recommended for production for security reasons.
 * The token is exposed to the client, so use it only in a server environment or for testing purposes.
 *
 * Stateless design: session management is handled externally, and this client only handles API calls
 */
class OpenClawLLMClient implements LLMClient {
  private provider: OpenClawLLMProvider;

  constructor(config: OpenClawLLMClientConfig) {
    // Strip sessionKey at runtime too: an untyped JS caller can bypass the
    // Omit above and pass it anyway.
    const { sessionKey: _sessionKey, ...rest } = config as OpenClawLLMConfig;

    // Intentional dev/test escape hatch: this direct browser client exposes
    // credentials. For production, see docs/guide/choosing-packages.md#remote.
    this.provider = createOpenClawLLMProvider({
      ...rest,
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
): LLMClient {
  return new OpenClawLLMClient(config);
}
