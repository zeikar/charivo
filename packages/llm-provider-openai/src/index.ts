import OpenAI from "openai";
import { LLMProvider, Character } from "@charivo/core";

export interface OpenAILLMConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Allow usage in browser (dangerous - exposes API key)
   * Only use for testing/development
   */
  dangerouslyAllowBrowser?: boolean;
}

export class OpenAILLMProvider implements LLMProvider {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: OpenAILLMConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new Error(
        "OpenAI LLM provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.openai = new OpenAI({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    });

    this.model = config.model || "gpt-4.1-nano";
    this.temperature = config.temperature || 0.7;
    this.maxTokens = config.maxTokens || 1000;
  }

  async generateResponse(
    messages: Array<{ role: string; content: string }>,
    _character?: Character,
  ): Promise<string> {
    try {
      // Messages already include system prompt from LLMManager
      // Just convert to OpenAI format
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
      throw new Error(
        `OpenAI LLM Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  setCharacter(_character: Character): void {
    // Provider에서는 필요시 character 정보를 저장할 수 있지만,
    // 주로 generateResponse 호출 시 전달받는 방식을 사용
  }
}

export function createOpenAILLMProvider(
  config: OpenAILLMConfig,
): OpenAILLMProvider {
  return new OpenAILLMProvider(config);
}
