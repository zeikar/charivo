import OpenAI from "openai";
import {
  CharivoStateError,
  CharivoTimeoutError,
  LLMProvider,
  toCharivoError,
  type LLMMessage,
  type LLMToolResponse,
  type ToolDefinition,
} from "@charivo/core";
import {
  toLLMToolResponse,
  toOpenAIChatMessages,
  toOpenAITools,
} from "../openai-tool-format";

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = "gpt-5.6-luna";

export type OpenAIReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high";

export interface OpenAILLMConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Sent as `reasoning_effort`. On gpt-5 family models, chat completions
   * accept function tools and a custom `temperature` only with `"none"`.
   * Models without reasoning (gpt-4.1, gpt-4o) reject the parameter, so it is
   * sent only when set - except on the default model, `gpt-5.6-luna`, where
   * it defaults to `"none"`. Set it yourself for other gpt-5 family models.
   */
  reasoningEffort?: OpenAIReasoningEffort;
  dangerouslyAllowBrowser?: boolean;
}

export class OpenAILLMProvider implements LLMProvider {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private reasoningEffort?: OpenAIReasoningEffort;

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

    this.model = config.model || DEFAULT_MODEL;
    this.temperature = config.temperature || 0.7;
    this.maxTokens = config.maxTokens || 1000;
    this.reasoningEffort =
      config.reasoningEffort ??
      (this.model === DEFAULT_MODEL ? "none" : undefined);
  }

  /** Sampling parameters shared by both request kinds. */
  private requestParams() {
    return {
      model: this.model,
      temperature: this.temperature,
      // gpt-5 family models reject `max_tokens`; every current chat model
      // accepts `max_completion_tokens`.
      max_completion_tokens: this.maxTokens,
      ...(this.reasoningEffort
        ? { reasoning_effort: this.reasoningEffort }
        : {}),
    };
  }

  async generateResponse(messages: LLMMessage[]): Promise<string> {
    try {
      const completion = await withTimeout(
        (signal) =>
          this.openai.chat.completions.create(
            {
              ...this.requestParams(),
              messages: toOpenAIChatMessages(messages),
            },
            { signal },
          ),
        `OpenAI LLM request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );

      return completion.choices[0]?.message?.content || "";
    } catch (error) {
      throw toCharivoError("provider", error, "OpenAI LLM request failed");
    }
  }

  async generateResponseWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMToolResponse> {
    try {
      const openAITools = toOpenAITools(tools);

      const completion = await withTimeout(
        (signal) =>
          this.openai.chat.completions.create(
            {
              ...this.requestParams(),
              messages: toOpenAIChatMessages(messages),
              ...(openAITools ? { tools: openAITools } : {}),
            },
            { signal },
          ),
        `OpenAI LLM request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );

      return toLLMToolResponse(completion.choices[0]?.message);
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

/**
 * Aborts the underlying SDK request on timeout instead of only abandoning the
 * wrapper promise: the SDK stops waiting and stops retrying, and the aborted
 * request becomes a cancellation request to the server. Work OpenAI already
 * accepted before the abort may still be billed.
 */
async function withTimeout<T>(
  makeRequest: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new CharivoTimeoutError(timeoutMessage));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([makeRequest(controller.signal), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
