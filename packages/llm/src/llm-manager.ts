import {
  LLMClient,
  Message,
  Character,
  assertToolResultObject,
  toCharivoError,
  validateToolArguments,
  type CharivoEventEmitter,
  type LLMManager as CoreLLMManager,
  type LLMMessage,
  type LLMToolCall,
  type ToolDefinition,
  type ToolRegistration,
  type ToolResultProjector,
} from "@charivo/core";
import { MessageHistoryManager } from "./message-history-manager";
import { CharacterPromptBuilder } from "./character-prompt-builder";
import { MessageConverter, type LLMApiMessage } from "./message-converter";
import { LLMValidators } from "./validators";
import { ResponseMessageBuilder } from "./response-message-builder";
import {
  createFailureOutput,
  LLMToolRegistry,
  withTimeout,
} from "./tool-execution";

const DEFAULT_MAX_HISTORY_TURNS = 40;
const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
/** Tool rounds actually executed before the reply is forced to finish. */
const MAX_TOOL_ROUNDS = 3;

export interface LLMManagerOptions {
  maxHistoryTurns?: number | null;
  tools?: ToolRegistration[];
  resultProjectors?: ToolResultProjector[];
  /** Appended to the character system prompt, tools path only. */
  toolInstructions?: string;
  defaultToolTimeoutMs?: number;
}

/**
 * LLM Manager - Class responsible for managing the state of an LLM session
 *
 * Responsibilities:
 * - Character configuration and management
 * - Message history management
 * - Communication with the LLM client
 * - Message format conversion
 * - Prompt generation
 */
export class LLMManager {
  private readonly historyManager: MessageHistoryManager;
  private readonly maxHistoryMessages?: number;
  private readonly toolRegistry = new LLMToolRegistry();
  private readonly resultProjectors: ToolResultProjector[];
  private readonly defaultToolTimeoutMs: number;
  private character: Character | null = null;
  private eventEmitter?: CharivoEventEmitter;
  private toolInstructions: string | null;

  constructor(
    private llmClient: LLMClient,
    options: LLMManagerOptions = {},
  ) {
    this.maxHistoryMessages = resolveMaxHistoryMessages(options);
    this.historyManager = new MessageHistoryManager({
      maxMessages: this.maxHistoryMessages,
      pruneBatchSize: 2,
    });
    this.resultProjectors = options.resultProjectors ?? [];
    this.defaultToolTimeoutMs =
      options.defaultToolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    this.toolInstructions = options.toolInstructions ?? null;

    for (const tool of options.tools ?? []) {
      this.registerTool(tool);
    }
  }

  setEventEmitter(eventEmitter: CharivoEventEmitter): void {
    this.eventEmitter = eventEmitter;
  }

  registerTool(tool: ToolRegistration): void {
    this.toolRegistry.register(tool);
  }

  unregisterTool(name: string): void {
    this.toolRegistry.unregister(name);
  }

  getRegisteredTools(): ToolDefinition[] {
    return this.toolRegistry.getDefinitions();
  }

  /**
   * Set the tool instructions appended to the system prompt.
   * Pass null to clear them.
   */
  setToolInstructions(instructions: string | null): void {
    this.toolInstructions = instructions;
  }

  /**
   * Set the character
   * Clears the history only when the character changes.
   */
  setCharacter(character: Character): void {
    // Clear the history only when the character changes
    if (this.character?.id !== character.id) {
      this.historyManager.clear();
    }
    this.character = character;
  }

  /**
   * Return the currently configured character
   */
  getCharacter(): Character | null {
    return this.character;
  }

  /**
   * Clear the history
   */
  clearHistory(): void {
    this.historyManager.clear();
  }

  /**
   * Return the current history
   */
  getHistory(): Message[] {
    return this.historyManager.getAll();
  }

  /**
   * Generate a response to a message
   */
  async generateResponse(message: Message): Promise<string> {
    try {
      LLMValidators.validateCharacterSet(this.character);
      LLMValidators.validateMessage(message);
    } catch (error) {
      throw toCharivoError("state", error);
    }

    // Defer pruning until the assistant message is appended. On failure we
    // only removeLast() the in-flight user message, so older history must
    // remain intact during the API call.
    this.historyManager.add(message, { prune: false });

    // Get the history messages
    const historyMessages = this.getHistoryForApiCall();

    // Convert to LLM API format (including the system prompt)
    const apiMessages = this.prepareApiMessages(historyMessages);

    try {
      // Generate a response via the LLM client
      const assistantMessage = this.shouldUseToolLoop()
        ? await this.runToolLoop(apiMessages)
        : await this.llmClient.call(apiMessages);

      // Build the AI response message and add it to the history.
      // Only the final assistant text is persisted: tool-call and tool-result
      // turns stay inside the loop so the stored history remains a plain
      // user/character transcript that other modalities can reuse.
      const responseMessage = ResponseMessageBuilder.create(
        assistantMessage,
        this.character!.id, // character is guaranteed non-null after validateCharacterSet
      );
      this.historyManager.add(responseMessage, { prune: false });
      this.historyManager.pruneToMax();

      return assistantMessage;
    } catch (error) {
      // On error, remove the last message from the history
      this.historyManager.removeLast();
      throw toCharivoError("provider", error);
    }
  }

  /**
   * Tools engage only when both sides opt in: at least one registered tool and
   * a client that implements the optional tool-calling variant.
   */
  private shouldUseToolLoop(): boolean {
    return (
      this.toolRegistry.size() > 0 &&
      typeof this.llmClient.callWithTools === "function"
    );
  }

  /**
   * Run the tool-calling conversation until the model answers with text or the
   * round cap is reached.
   */
  private async runToolLoop(apiMessages: LLMApiMessage[]): Promise<string> {
    // Guarded by shouldUseToolLoop(): callWithTools exists on this path
    const callWithTools = this.llmClient.callWithTools!.bind(this.llmClient);
    const definitions = this.getRegisteredTools();
    const working = this.buildToolLoopMessages(apiMessages);

    let response = await callWithTools(working, definitions);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const toolCalls = response.toolCalls ?? [];
      if (toolCalls.length === 0) {
        return response.content;
      }

      working.push({
        role: "assistant",
        content: response.content,
        toolCalls,
      });

      for (const toolCall of toolCalls) {
        working.push({
          role: "tool",
          content: await this.executeToolCall(toolCall),
          toolCallId: toolCall.id,
        });
      }

      // Terminal call offers no tools so the reply is text, not an unexecuted tool request.
      const isFinalRound = round === MAX_TOOL_ROUNDS - 1;
      response = await callWithTools(working, isFinalRound ? [] : definitions);
    }

    // Round cap reached: return the model's text instead of executing more tools
    return response.content;
  }

  /**
   * Seed the tool conversation, appending the tool instructions to the system
   * prompt. generateResponse validates the character first, so the tools path
   * always starts with a system message.
   */
  private buildToolLoopMessages(apiMessages: LLMApiMessage[]): LLMMessage[] {
    const messages: LLMMessage[] = [...apiMessages];
    const systemMessage = messages[0];

    if (this.toolInstructions && systemMessage.role === "system") {
      messages[0] = {
        role: "system",
        content: `${systemMessage.content}\n\n${this.toolInstructions}`,
      };
    }

    return messages;
  }

  /**
   * Execute one tool call and return the serialized output for its tool turn.
   * Every failure - unknown tool, invalid arguments, handler throw/timeout,
   * non-object result, unserializable output - becomes a failure output so the
   * reply always continues.
   */
  private async executeToolCall(toolCall: LLMToolCall): Promise<string> {
    let output: Record<string, unknown>;
    let serialized: string;

    try {
      const tool = this.toolRegistry.get(toolCall.name);
      if (!tool) {
        throw new Error(`No LLM tool registered for "${toolCall.name}"`);
      }

      validateToolArguments(tool.definition, toolCall.arguments, "LLM tool");

      const result = await withTimeout(
        tool.handler(toolCall.arguments, {
          character: this.character,
          callId: toolCall.id,
        }),
        tool.timeoutMs ?? this.defaultToolTimeoutMs,
        tool.definition.name,
      );

      assertToolResultObject(result, tool.definition.name, "LLM tool");

      // Serialize inside the failure boundary: outputs that cannot be
      // stringified (bigint values, circular references) degrade to a failure
      // output instead of aborting the reply.
      serialized = JSON.stringify(result);
      output = result;
    } catch (error) {
      return JSON.stringify(createFailureOutput(toError(error)));
    }

    this.projectToolResult(toolCall.name, output, toolCall.id);

    return serialized;
  }

  /**
   * Turn a successful tool result into avatar-style events. Projection is
   * skipped entirely without an event emitter.
   */
  private projectToolResult(
    name: string,
    output: Record<string, unknown>,
    callId: string,
  ): void {
    const eventEmitter = this.eventEmitter;
    if (!eventEmitter) {
      return;
    }

    for (const projector of this.resultProjectors) {
      try {
        projector({
          name,
          output,
          callId,
          emit: (event, payload) => {
            eventEmitter.emit(event, payload);
          },
        });
      } catch (error) {
        eventEmitter.emit("error", {
          error: new Error(
            `LLM result projector failed for tool "${name}": ${toError(error).message}`,
          ),
        });
      }
    }
  }

  /**
   * Prepare messages for the LLM API call
   */
  private prepareApiMessages(messages: Message[]): LLMApiMessage[] {
    if (!this.character) {
      return MessageConverter.toOpenAIFormat(messages);
    }

    const systemPrompt = CharacterPromptBuilder.buildSystemPrompt(
      this.character,
    );
    return MessageConverter.combineWithSystemPrompt(systemPrompt, messages);
  }

  private getHistoryForApiCall(): Message[] {
    const historyMessages = this.historyManager.getRecent(
      this.maxHistoryMessages,
    );

    if (historyMessages[0]?.type === "character") {
      return historyMessages.slice(1);
    }

    return historyMessages;
  }
}

/**
 * Helper function to create an LLM Manager
 */
export function createLLMManager(
  llmClient: LLMClient,
  options?: LLMManagerOptions,
): CoreLLMManager {
  return new LLMManager(llmClient, options);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function resolveMaxHistoryMessages(
  options: LLMManagerOptions,
): number | undefined {
  if (options.maxHistoryTurns === null) {
    return undefined;
  }

  const maxHistoryTurns = options.maxHistoryTurns ?? DEFAULT_MAX_HISTORY_TURNS;

  if (!Number.isInteger(maxHistoryTurns) || maxHistoryTurns <= 0) {
    throw new TypeError("maxHistoryTurns must be a positive integer or null");
  }

  return maxHistoryTurns * 2;
}
