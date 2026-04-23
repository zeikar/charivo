import OpenAI from "openai";
import { CharivoStateError, LLMProvider, toCharivoError } from "@charivo/core";

export interface OpenClawLLMConfig {
  token: string;
  baseURL?: string;
  agentId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  dangerouslyAllowBrowser?: boolean;
}

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
      defaultHeaders: {
        "x-openclaw-agent-id": config.agentId || "main",
      },
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    });

    this.model = config.model || "openclaw";
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
