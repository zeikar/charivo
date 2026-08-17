import {
  CharivoProviderError,
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  type LLMCallOptions,
  type LLMClient,
  type LLMMessage,
  type LLMToolCall,
  type LLMToolResponse,
  type ToolDefinition,
} from "@charivo/core";

export interface RemoteLLMConfig {
  apiEndpoint?: string;
}

/** Server reply as received; each field is validated where it is read. */
interface RemoteLLMResponseBody {
  success?: boolean;
  error?: string;
  message?: string;
  toolCalls?: unknown;
}

/**
 * Remote LLM Client - stateless client that calls the server API
 */
class RemoteLLMClient implements LLMClient {
  private apiEndpoint: string;

  constructor(config: RemoteLLMConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/chat";
  }

  async call(
    messages: Array<{ role: string; content: string }>,
    options?: LLMCallOptions,
  ): Promise<string> {
    const data = await postChatRequest(
      this.apiEndpoint,
      { messages },
      options?.signal,
    );

    if (!data.success) {
      throw new CharivoProviderError(
        data.error || "Failed to generate response",
      );
    }

    return data.message || "";
  }

  /**
   * Tools are sent as-is, including an empty array: the server is expected to
   * treat an empty list as no tools for that turn.
   */
  async callWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options?: LLMCallOptions,
  ): Promise<LLMToolResponse> {
    const data = await postChatRequest(
      this.apiEndpoint,
      { messages, tools },
      options?.signal,
    );

    // Cast through `unknown` so the guard doesn't narrow `data`'s declared shape
    // away to a bare index signature - the fields below still need their types.
    if (!isPlainObject(data as unknown)) {
      throw new CharivoProviderError("Malformed response body");
    }

    // `!== true` keeps the missing/false error path and rejects non-boolean flags.
    if (data.success !== true) {
      throw new CharivoProviderError(
        data.error || "Failed to generate response",
      );
    }

    if (typeof data.message !== "string") {
      throw new CharivoProviderError(
        'LLM response field "message" must be a string',
      );
    }

    const toolCalls = parseToolCalls(data.toolCalls);

    return {
      content: data.message,
      ...(toolCalls ? { toolCalls } : {}),
    };
  }
}

export function createRemoteLLMClient(config?: RemoteLLMConfig): LLMClient {
  return new RemoteLLMClient(config);
}

async function postChatRequest(
  apiEndpoint: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<RemoteLLMResponseBody> {
  return fetchWithTimeout(
    apiEndpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMessage: `LLM request timed out after ${DEFAULT_FETCH_TIMEOUT_MS}ms`,
      failureMessage: "LLM request failed",
      signal,
    },
    // Consume the body while cancellation is still wired up, so an abort
    // during a slow/streaming response body still cancels the request.
    async (response) => {
      if (!response.ok) {
        let errorData: { error?: string } = { error: "Unknown error" };
        try {
          errorData = await response.json();
        } catch (parseError) {
          // Only a malformed/non-JSON error body falls back to the default
          // message. Anything else (e.g. an abort or timeout mid-read)
          // propagates as-is so fetchWithTimeout classifies it, instead of
          // masking it behind a generic provider error.
          if (!(parseError instanceof SyntaxError)) {
            throw parseError;
          }
        }
        throw new CharivoProviderError(
          `API call failed: ${errorData.error || response.statusText}`,
        );
      }

      return response.json() as Promise<RemoteLLMResponseBody>;
    },
  );
}

function parseToolCalls(value: unknown): LLMToolCall[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new CharivoProviderError(
      'LLM response field "toolCalls" must be an array',
    );
  }

  if (value.length === 0) {
    return undefined;
  }

  return value.map(parseToolCall);
}

function parseToolCall(value: unknown): LLMToolCall {
  if (!isPlainObject(value)) {
    throw new CharivoProviderError("LLM tool call must be an object");
  }

  const { id, name, arguments: args } = value;

  if (typeof id !== "string" || id.length === 0) {
    throw new CharivoProviderError(
      'LLM tool call is missing a non-empty string "id"',
    );
  }

  if (typeof name !== "string" || name.length === 0) {
    throw new CharivoProviderError(
      `LLM tool call "${id}" is missing a non-empty string "name"`,
    );
  }

  if (!isPlainObject(args)) {
    throw new CharivoProviderError(
      `LLM tool call "${name}" has "arguments" that are not a JSON object`,
    );
  }

  return { id, name, arguments: args };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
