import OpenAI from "openai";
import { CharivoStateError, LLMProvider, toCharivoError } from "@charivo/core";

export interface OpenClawLLMConfig {
  token: string;
  baseURL?: string;
  /**
   * Target a specific agent on the gateway.
   * When omitted, the gateway's configured default agent handles the request.
   */
  agentId?: string;
  /**
   * Agent target, not a backend model name. The gateway resolves this to an
   * agent: `openclaw`, `openclaw/default`, or `openclaw/<agentId>`.
   *
   * @default "openclaw/default"
   */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  dangerouslyAllowBrowser?: boolean;
}

// No `sessionKey` here, unlike `@charivo/server/openclaw`. Pinning the gateway
// session requires rotating it on reset, and this provider is driven by
// LLMManager, whose clearHistory()/character switch clear only local history and
// cannot reach the client. A pinned session would survive that reset and silently
// replay the old conversation. Server routes construct the provider themselves and
// can rotate the key, so the option lives there instead.

export class OpenClawLLMProvider implements LLMProvider {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: OpenClawLLMConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new CharivoStateError(
        "OpenClaw LLM provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.openai = new OpenAI({
      apiKey: config.token,
      baseURL: config.baseURL || "http://127.0.0.1:18789/v1",
      defaultHeaders: config.agentId
        ? { "x-openclaw-agent-id": config.agentId }
        : undefined,
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    });

    this.model = config.model || "openclaw/default";
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens || 1000;
  }

  async generateResponse(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    try {
      const openAIMessages = messages.map((msg) => ({
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      }));

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: openAIMessages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      });

      return completion.choices[0]?.message?.content || "";
    } catch (error) {
      throw toCharivoError("provider", error, "OpenClaw LLM request failed");
    }
  }
}

export function createOpenClawLLMProvider(
  config: OpenClawLLMConfig,
): OpenClawLLMProvider {
  return new OpenClawLLMProvider(config);
}
