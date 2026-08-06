/**
 * Mapping between the neutral LLM tool contracts and the OpenAI
 * chat.completions wire format. Shared by the OpenAI provider and the OpenClaw
 * gateway provider, which speaks the same API.
 */
import {
  CharivoProviderError,
  type LLMMessage,
  type LLMToolCall,
  type LLMToolResponse,
  type ToolDefinition,
} from "@charivo/core";
import type OpenAI from "openai";

export function toOpenAIChatMessages(
  messages: LLMMessage[],
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    switch (message.role) {
      case "tool":
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      case "assistant":
        return {
          role: "assistant",
          content: message.content,
          ...(message.toolCalls && message.toolCalls.length > 0
            ? { tool_calls: message.toolCalls.map(toOpenAIToolCall) }
            : {}),
        };
      case "system":
      case "user":
        return { role: message.role, content: message.content };
    }
  });
}

/**
 * Returns undefined for an empty list so callers can spread the result and
 * leave the `tools` param out entirely: an empty array would still switch the
 * model into tool mode.
 */
export function toOpenAITools(
  tools: ToolDefinition[],
): OpenAI.ChatCompletionTool[] | undefined {
  if (tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Builds the neutral tool response from a completion message. Shared by the
 * OpenAI and OpenClaw providers, which both read from the same wire shape.
 */
export function toLLMToolResponse(
  message: OpenAI.ChatCompletionMessage | undefined,
): LLMToolResponse {
  const toolCalls = readToolCalls(message);

  return {
    content: message?.content ?? "",
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

/**
 * Read the tool calls off a completion message. The SDK types promise more than
 * the wire delivers - especially through a gateway - so every field is checked
 * before it reaches the neutral contract.
 */
function readToolCalls(
  message: OpenAI.ChatCompletionMessage | undefined,
): LLMToolCall[] {
  const rawToolCalls = message?.tool_calls;
  if (!rawToolCalls || rawToolCalls.length === 0) {
    return [];
  }

  return rawToolCalls.map(toLLMToolCall);
}

function toOpenAIToolCall(
  toolCall: LLMToolCall,
): OpenAI.ChatCompletionMessageToolCall {
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function toLLMToolCall(raw: OpenAI.ChatCompletionMessageToolCall): LLMToolCall {
  if (!isPlainObject(raw)) {
    throw new CharivoProviderError("LLM tool call must be an object");
  }

  const id = raw.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new CharivoProviderError(
      'LLM tool call is missing a non-empty string "id"',
    );
  }

  const name = raw.function?.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new CharivoProviderError(
      `LLM tool call "${id}" is missing a non-empty string "function.name"`,
    );
  }

  return {
    id,
    name,
    arguments: parseToolArguments(name, raw.function.arguments),
  };
}

function parseToolArguments(
  name: string,
  rawArguments: string,
): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawArguments);
  } catch (error) {
    throw new CharivoProviderError(
      `LLM tool call "${name}" has unparsable "function.arguments"`,
      { cause: error instanceof Error ? error : undefined },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CharivoProviderError(
      `LLM tool call "${name}" has "function.arguments" that are not a JSON object`,
    );
  }

  return parsed as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
