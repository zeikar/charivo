import OpenAI from "openai";
import {
  CharivoStateError,
  CharivoTimeoutError,
  LLMProvider,
  toCharivoError,
} from "@charivo/core";

const REQUEST_TIMEOUT_MS = 30_000;

export interface OpenAILLMConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  dangerouslyAllowBrowser?: boolean;
}

export class OpenAILLMProvider implements LLMProvider {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: OpenAILLMConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new CharivoStateError(
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
  ): Promise<string> {
    try {
      const openAIMessages = messages.map((msg) => ({
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      }));

      const completion = await withTimeout(
        this.openai.chat.completions.create({
          model: this.model,
          messages: openAIMessages,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        }),
        `request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );

      return completion.choices[0]?.message?.content || "";
    } catch (error) {
      throw toCharivoError("provider", error, "OpenAI LLM request failed");
    }
  }
}

export function createOpenAILLMProvider(
  config: OpenAILLMConfig,
): OpenAILLMProvider {
  return new OpenAILLMProvider(config);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new CharivoTimeoutError(timeoutMessage)),
      REQUEST_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
