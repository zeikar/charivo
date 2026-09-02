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

const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const REQUEST_TIMEOUT_MS = 30_000;

/** Sent in place of the real thought signature Gemini returned; see `toGeminiChatMessages`. */
const THOUGHT_SIGNATURE_SKIP = "skip_thought_signature_validator";

export interface GeminiLLMConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  dangerouslyAllowBrowser?: boolean;
}

type GeminiToolCall = OpenAI.ChatCompletionMessageToolCall & {
  extra_content?: { google: { thought_signature: string } };
};

/**
 * `toOpenAIChatMessages`'s output widened so an assistant tool-call message can
 * carry Gemini's `extra_content.google.thought_signature` on its first tool
 * call, a field `openai`'s `ChatCompletionMessageToolCall` type does not model.
 */
type GeminiChatMessage =
  | Exclude<
      OpenAI.ChatCompletionMessageParam,
      OpenAI.ChatCompletionAssistantMessageParam
    >
  | (Omit<OpenAI.ChatCompletionAssistantMessageParam, "tool_calls"> & {
      tool_calls?: GeminiToolCall[];
    });

/**
 * Gemini 3 answers HTTP 400 ("Function call is missing a thought_signature in
 * functionCall parts") when a resent assistant `tool_calls` turn lacks the
 * `thought_signature` Gemini attached to its first call. `LLMToolCall` has no
 * field for the real signature Gemini returned, so this provider sends a
 * documented skip placeholder instead and loses reasoning continuity across
 * tool rounds.
 */
export class GeminiLLMProvider implements LLMProvider {
  private openai: OpenAI;
  private model: string;
  private temperature?: number;
  private maxTokens: number;

  constructor(config: GeminiLLMConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new CharivoStateError(
        "Gemini LLM provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: GEMINI_BASE_URL,
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    });

    this.model = config.model || DEFAULT_MODEL;
    this.temperature = config.temperature;
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
        (signal) =>
          this.openai.chat.completions.create(
            {
              model: this.model,
              messages: openAIMessages,
              ...(this.temperature !== undefined
                ? { temperature: this.temperature }
                : {}),
              max_tokens: this.maxTokens,
            },
            { signal },
          ),
        `Gemini LLM request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );

      return completion.choices[0]?.message?.content || "";
    } catch (error) {
      throw toCharivoError("provider", error, "Gemini LLM request failed");
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
              model: this.model,
              messages: toGeminiChatMessages(messages),
              ...(this.temperature !== undefined
                ? { temperature: this.temperature }
                : {}),
              max_tokens: this.maxTokens,
              ...(openAITools ? { tools: openAITools } : {}),
            },
            { signal },
          ),
        `Gemini LLM request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );

      return toLLMToolResponse(completion.choices[0]?.message);
    } catch (error) {
      throw toCharivoError("provider", error, "Gemini LLM request failed");
    }
  }
}

export function createGeminiLLMProvider(
  config: GeminiLLMConfig,
): GeminiLLMProvider {
  return new GeminiLLMProvider(config);
}

/**
 * Stamps the documented skip placeholder for `thought_signature` onto only
 * `tool_calls[0]` of each assistant tool-call message: Gemini attaches the real
 * signature to the first call of a parallel group, and every other message
 * (including `tool_calls[1..]`) is left as `toOpenAIChatMessages` produced it.
 */
function toGeminiChatMessages(messages: LLMMessage[]): GeminiChatMessage[] {
  return toOpenAIChatMessages(messages).map((message) => {
    // `role: "tool"` messages pass through unchanged, with no `name` field: the
    // OpenAI-compatible endpoint resolves the function from `tool_call_id`
    // (verified across sequential and parallel tool rounds). `name` is a
    // requirement of the native `functionResponse` / Interactions surfaces, not this one.
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      return message;
    }

    return {
      ...message,
      tool_calls: message.tool_calls.map((toolCall, index) =>
        index === 0
          ? {
              ...toolCall,
              extra_content: {
                google: { thought_signature: THOUGHT_SIGNATURE_SKIP },
              },
            }
          : toolCall,
      ),
    };
  });
}

/**
 * Aborts the underlying SDK request on timeout instead of only abandoning the
 * wrapper promise: the SDK stops waiting and stops retrying, and the aborted
 * request becomes a cancellation request to the server. Work Gemini already
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
