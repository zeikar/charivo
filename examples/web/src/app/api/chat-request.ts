/**
 * Shared request-body validation for `/api/chat` and `/api/chat-openclaw`.
 *
 * Message validation is role-discriminated: a payload that would produce a
 * protocol-invalid OpenAI request (an unknown role, `toolCalls` on a
 * `system`/`user` turn, a `tool` turn without a `toolCallId`, ...) is
 * rejected here instead of reaching the provider.
 *
 * Size bounds live alongside it: these routes proxy an unauthenticated caller
 * onto a paid key, so a payload that is merely *shaped* correctly is not enough
 * — see `demo-limits.ts`.
 */
import type { LLMMessage, LLMToolCall, ToolDefinition } from "@charivo/core";
import {
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_MAX_MESSAGES,
  CHAT_MAX_TOOL_CALL_ID_CHARS,
  CHAT_MAX_TOOL_CALLS_BYTES,
  CHAT_MAX_TOOL_CALLS_PER_MESSAGE,
  CHAT_MAX_TOOLS,
  CHAT_MAX_TOOLS_BYTES,
  CHAT_MAX_TOTAL_CHARS,
} from "./demo-limits";

export interface ParsedChatRequest {
  messages: LLMMessage[];
  /**
   * `undefined` when the request body omitted `tools` entirely. An empty
   * array is a distinct, valid value - see `requiresToolCallingPath`.
   */
  tools?: ToolDefinition[];
}

export type ParseResult<T> =
  | { success: true; value: T }
  | { success: false; error: string };

export function parseChatRequest(
  body: unknown,
): ParseResult<ParsedChatRequest> {
  if (!isPlainObject(body)) {
    return fail("Request body must be a JSON object");
  }

  const { messages, tools } = body;

  if (!Array.isArray(messages)) {
    return fail("Messages array is required");
  }

  if (messages.length > CHAT_MAX_MESSAGES) {
    return fail(`messages exceeds ${CHAT_MAX_MESSAGES} entries`);
  }

  const parsedMessages: LLMMessage[] = [];
  let totalChars = 0;
  for (let index = 0; index < messages.length; index++) {
    const result = parseChatMessage(messages[index], index);
    if (!result.success) {
      return result;
    }
    totalChars += result.value.content.length;
    if (totalChars > CHAT_MAX_TOTAL_CHARS) {
      return fail(
        `messages exceed ${CHAT_MAX_TOTAL_CHARS} characters in total`,
      );
    }
    parsedMessages.push(result.value);
  }

  if (tools === undefined) {
    return ok({ messages: parsedMessages });
  }

  const toolsResult = parseTools(tools);
  if (!toolsResult.success) {
    return toolsResult;
  }

  return ok({ messages: parsedMessages, tools: toolsResult.value });
}

/**
 * The terminal round of a tool loop sends `tools: []` while `messages` still
 * carries the tool-call history (assistant `toolCalls` turns and `role:
 * "tool"` results). Those turns are protocol-invalid for the plain
 * `{role, content}[]` `generateResponse` call, so any request that carries a
 * `tools` key at all (even empty) or a tool-ish turn in `messages` must use
 * `generateResponseWithTools` instead. Only a `tools`-less request built
 * entirely from plain `{role, content}` turns takes the `generateResponse`
 * path.
 */
export function requiresToolCallingPath(parsed: ParsedChatRequest): boolean {
  return parsed.tools !== undefined || parsed.messages.some(isToolishMessage);
}

function isToolishMessage(message: LLMMessage): boolean {
  return (
    message.role === "tool" ||
    (message.role === "assistant" &&
      !!message.toolCalls &&
      message.toolCalls.length > 0)
  );
}

function parseChatMessage(
  raw: unknown,
  index: number,
): ParseResult<LLMMessage> {
  if (!isPlainObject(raw)) {
    return fail(`messages[${index}] must be an object`);
  }

  const { role, content, toolCalls, toolCallId } = raw;

  if (typeof content !== "string") {
    return fail(`messages[${index}].content must be a string`);
  }

  if (content.length > CHAT_MAX_MESSAGE_CHARS) {
    return fail(
      `messages[${index}].content exceeds ${CHAT_MAX_MESSAGE_CHARS} characters`,
    );
  }

  if (role === "system" || role === "user") {
    if (toolCalls !== undefined || toolCallId !== undefined) {
      return fail(
        `messages[${index}] with role "${role}" must not include toolCalls or toolCallId`,
      );
    }
    return ok({ role, content });
  }

  if (role === "assistant") {
    if (toolCallId !== undefined) {
      return fail(
        `messages[${index}] with role "assistant" must not include toolCallId`,
      );
    }
    if (toolCalls === undefined) {
      return ok({ role: "assistant", content });
    }
    const toolCallsResult = parseToolCalls(toolCalls, index);
    if (!toolCallsResult.success) {
      return toolCallsResult;
    }
    return ok({ role: "assistant", content, toolCalls: toolCallsResult.value });
  }

  if (role === "tool") {
    if (toolCalls !== undefined) {
      return fail(
        `messages[${index}] with role "tool" must not include toolCalls`,
      );
    }
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      return fail(
        `messages[${index}] with role "tool" requires a non-empty string toolCallId`,
      );
    }
    // Forwarded to the provider as paid input, and not covered by the content cap.
    if (toolCallId.length > CHAT_MAX_TOOL_CALL_ID_CHARS) {
      return fail(
        `messages[${index}].toolCallId exceeds ${CHAT_MAX_TOOL_CALL_ID_CHARS} characters`,
      );
    }
    return ok({ role: "tool", content, toolCallId });
  }

  return fail(
    `messages[${index}] has an unknown role: ${JSON.stringify(role)}`,
  );
}

function parseToolCalls(
  raw: unknown,
  messageIndex: number,
): ParseResult<LLMToolCall[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail(
      `messages[${messageIndex}].toolCalls must be a non-empty array when present`,
    );
  }

  if (raw.length > CHAT_MAX_TOOL_CALLS_PER_MESSAGE) {
    return fail(
      `messages[${messageIndex}].toolCalls exceeds ${CHAT_MAX_TOOL_CALLS_PER_MESSAGE} entries`,
    );
  }

  // Names, ids, and `arguments` are all forwarded as paid input, and none of
  // them are covered by the per-message content cap.
  if (serializedSize(raw) > CHAT_MAX_TOOL_CALLS_BYTES) {
    return fail(
      `messages[${messageIndex}].toolCalls exceeds ${CHAT_MAX_TOOL_CALLS_BYTES} bytes`,
    );
  }

  const toolCalls: LLMToolCall[] = [];
  for (let index = 0; index < raw.length; index++) {
    const result = parseToolCall(raw[index], messageIndex, index);
    if (!result.success) {
      return result;
    }
    toolCalls.push(result.value);
  }
  return ok(toolCalls);
}

function parseToolCall(
  raw: unknown,
  messageIndex: number,
  callIndex: number,
): ParseResult<LLMToolCall> {
  const label = `messages[${messageIndex}].toolCalls[${callIndex}]`;
  if (!isPlainObject(raw)) {
    return fail(`${label} must be an object`);
  }

  const { id, name, arguments: args } = raw;

  if (typeof id !== "string" || id.length === 0) {
    return fail(`${label}.id must be a non-empty string`);
  }
  if (typeof name !== "string" || name.length === 0) {
    return fail(`${label}.name must be a non-empty string`);
  }
  if (!isPlainObject(args)) {
    return fail(`${label}.arguments must be a plain object`);
  }

  return ok({ id, name, arguments: args });
}

function parseTools(raw: unknown): ParseResult<ToolDefinition[]> {
  if (!Array.isArray(raw)) {
    return fail("tools must be an array");
  }

  if (raw.length > CHAT_MAX_TOOLS) {
    return fail(`tools exceeds ${CHAT_MAX_TOOLS} entries`);
  }

  // A tool definition carries a free-form description and JSON Schema, so entry
  // count alone bounds nothing.
  if (serializedSize(raw) > CHAT_MAX_TOOLS_BYTES) {
    return fail(`tools exceeds ${CHAT_MAX_TOOLS_BYTES} bytes`);
  }

  const tools: ToolDefinition[] = [];
  for (let index = 0; index < raw.length; index++) {
    const result = parseToolDefinition(raw[index], index);
    if (!result.success) {
      return result;
    }
    tools.push(result.value);
  }
  return ok(tools);
}

function parseToolDefinition(
  raw: unknown,
  index: number,
): ParseResult<ToolDefinition> {
  const label = `tools[${index}]`;
  if (!isPlainObject(raw)) {
    return fail(`${label} must be an object`);
  }

  const { type, name, description, parameters } = raw;

  if (type !== "function") {
    return fail(`${label}.type must be "function"`);
  }
  if (typeof name !== "string" || name.length === 0) {
    return fail(`${label}.name must be a non-empty string`);
  }
  if (typeof description !== "string") {
    return fail(`${label}.description must be a string`);
  }

  const parametersResult = parseToolParameters(parameters, label);
  if (!parametersResult.success) {
    return parametersResult;
  }

  return ok({
    type: "function",
    name,
    description,
    parameters: parametersResult.value,
  });
}

function parseToolParameters(
  raw: unknown,
  label: string,
): ParseResult<ToolDefinition["parameters"]> {
  if (!isPlainObject(raw)) {
    return fail(`${label}.parameters must be an object`);
  }

  if (raw.type !== "object") {
    return fail(`${label}.parameters.type must be "object"`);
  }
  if (!isPlainObject(raw.properties)) {
    return fail(`${label}.parameters.properties must be an object`);
  }

  const { required } = raw;
  if (required !== undefined) {
    if (
      !Array.isArray(required) ||
      !required.every((item) => typeof item === "string")
    ) {
      return fail(`${label}.parameters.required must be an array of strings`);
    }
  }

  return ok({
    type: "object",
    properties: raw.properties,
    ...(required !== undefined ? { required: required as string[] } : {}),
  });
}

function ok<T>(value: T): ParseResult<T> {
  return { success: true, value };
}

function fail(error: string): ParseResult<never> {
  return { success: false, error };
}

/**
 * UTF-8 byte length of the payload as it will be forwarded. Returns Infinity for
 * anything JSON cannot represent (a cycle, a BigInt), so unserializable input
 * fails the bound rather than slipping past it.
 */
function serializedSize(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json === undefined
      ? Infinity
      : new TextEncoder().encode(json).length;
  } catch {
    return Infinity;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
