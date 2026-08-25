import {
  LLMClient,
  Message,
  Character,
  assertToolResultObject,
  createToolFailureOutput,
  createToolRegistry,
  snapshotToolResult,
  toCharivoError,
  validateToolArguments,
  withToolTimeout,
  type CharivoEventEmitter,
  type GenerateResponseOptions,
  type HistoryRollback,
  type LLMManagerWithTools,
  type LLMMessage,
  type LLMToolCall,
  type ToolDefinition,
  type ToolRegistration,
  type ToolResultProjector,
  type ToolResultSnapshot,
} from "@charivo/core";
import { MessageHistoryManager } from "./message-history-manager";
import { CharacterPromptBuilder } from "./character-prompt-builder";
import { MessageConverter, type LLMApiMessage } from "./message-converter";
import { LLMValidators } from "./validators";
import { ResponseMessageBuilder } from "./response-message-builder";

const DEFAULT_MAX_HISTORY_TURNS = 40;
const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
/** Tool rounds actually executed before the reply is forced to finish. */
const MAX_TOOL_ROUNDS = 3;

/**
 * Internal loop signal: a superseded turn skips the handler entirely, so there
 * is no tool turn to append and the round has to stop.
 */
type ToolCallOutcome = { executed: true; output: string } | { executed: false };

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
  private readonly toolRegistry = createToolRegistry();
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
   * Trim to the bound and report everything removed, in its original order.
   *
   * Pruning is exact rather than turn-sized: overlapping turns leave the
   * excess odd, and rounding up to a whole turn evicts the pending turn's
   * user message as well, stranding the reply it is about to commit. Turns
   * still leave together on the sequential path, where a committed pair
   * always makes the excess even.
   */
  private pruneWithoutStrandingReplies(): Message[] {
    const evicted = this.historyManager.pruneToBound();

    if (evicted.length > 0) {
      // Pruning a user message can strand its reply at the head. Only an
      // eviction-bearing prune drops it, so a deliberately character-first
      // history - a reply committed after clearHistory() - survives.
      evicted.push(...this.historyManager.removeLeadingCharacterMessages());
    }

    return evicted;
  }

  /**
   * Ensure the message is present in the history and return an undo handle.
   * Callers that own the turn (see GenerateResponseOptions.callerOwnsHistory)
   * write both the user message and the reply through here, so the transcript
   * they present and the transcript the next prompt is built from are the
   * same one.
   */
  addToHistory(message: Message): HistoryRollback {
    // Only user messages are validated: the reply commit has never been, so
    // an empty model response is still stored exactly as produced.
    if (message.type === "user") {
      try {
        LLMValidators.validateMessage(message);
      } catch (error) {
        throw toCharivoError("state", error);
      }
    }

    if (this.historyManager.contains(message)) {
      return () => {};
    }

    this.historyManager.add(message, { prune: false });
    const evicted = this.pruneWithoutStrandingReplies();
    const writeCount = this.historyManager.getWriteCount();

    let spent = false;
    return () => {
      if (spent) {
        return;
      }
      spent = true;

      // Restore only what this call evicted, and only when nothing else has
      // written since: a clearHistory() plus re-append can leave the array
      // looking untouched while the app deliberately discarded everything.
      const untouched = this.historyManager.getWriteCount() === writeCount;
      this.historyManager.remove(message);

      if (untouched) {
        this.historyManager.restoreToHead(evicted);
      }
    };
  }

  /**
   * Generate a response to a message
   */
  async generateResponse(
    message: Message,
    options: GenerateResponseOptions = {},
  ): Promise<string> {
    try {
      LLMValidators.validateCharacterSet(this.character);
      LLMValidators.validateMessage(message);
    } catch (error) {
      throw toCharivoError("state", error);
    }

    // The caller placed the message itself and commits the reply itself, so
    // this call writes nothing - not even a rollback on failure.
    const callerOwnsHistory = options.callerOwnsHistory === true;

    // Defer pruning until the assistant message is appended. On failure we
    // only remove this call's own user message, so older history must remain
    // intact during the API call.
    if (!callerOwnsHistory) {
      this.historyManager.add(message, { prune: false });
    }

    // Get the history messages
    const historyMessages = this.getHistoryForApiCall();

    // Convert to LLM API format (including the system prompt)
    const apiMessages = this.prepareApiMessages(historyMessages);

    try {
      // Generate a response via the LLM client
      const assistantMessage = this.shouldUseToolLoop()
        ? await this.runToolLoop(
            apiMessages,
            options.isCancelled ?? (() => false),
            options.signal,
          )
        : await this.llmClient.call(apiMessages, { signal: options.signal });

      // Build the AI response message and add it to the history.
      // Only the final assistant text is persisted: tool-call and tool-result
      // turns stay inside the loop so the stored history remains a plain
      // user/character transcript that other modalities can reuse.
      if (!callerOwnsHistory) {
        const responseMessage = ResponseMessageBuilder.create(
          assistantMessage,
          this.character!.id, // character is guaranteed non-null after validateCharacterSet
        );
        this.historyManager.add(responseMessage, { prune: false });
        this.pruneWithoutStrandingReplies();
      }

      return assistantMessage;
    } catch (error) {
      // Remove this call's own message by identity: an overlapping turn may
      // have appended after it, and duplicate ids make a lookup ambiguous.
      if (!callerOwnsHistory) {
        this.historyManager.remove(message);
      }
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
   * Run the tool-calling conversation until the model answers with text, the
   * round cap is reached, or the turn is superseded. A superseded turn starts
   * no further tool call and issues no further request; it returns the latest
   * text the model produced.
   */
  private async runToolLoop(
    apiMessages: LLMApiMessage[],
    isCancelled: () => boolean,
    signal?: AbortSignal,
  ): Promise<string> {
    // Guarded by shouldUseToolLoop(): callWithTools exists on this path
    const callWithTools = this.llmClient.callWithTools!.bind(this.llmClient);
    const definitions = this.getRegisteredTools();
    const working = this.buildToolLoopMessages(apiMessages);

    let response = await callWithTools(working, definitions, { signal });

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
        // An earlier handler in this same round can supersede the turn, and so
        // can a listener of the tool:call this executes - which is why the
        // outcome, not this check alone, decides whether the round continues.
        if (isCancelled()) {
          return response.content;
        }

        const outcome = await this.executeToolCall(toolCall, isCancelled);
        if (!outcome.executed) {
          return response.content;
        }

        working.push({
          role: "tool",
          content: outcome.output,
          toolCallId: toolCall.id,
        });
      }

      if (isCancelled()) {
        return response.content;
      }

      // Terminal call offers no tools so the reply is text, not an unexecuted tool request.
      const isFinalRound = round === MAX_TOOL_ROUNDS - 1;
      response = await callWithTools(working, isFinalRound ? [] : definitions, {
        signal,
      });
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
   *
   * Returns "not executed" when the turn is superseded before the handler
   * starts: there is no tool turn to push, so the caller stops the round.
   */
  private async executeToolCall(
    toolCall: LLMToolCall,
    isCancelled: () => boolean,
  ): Promise<ToolCallOutcome> {
    let outcome: ToolResultSnapshot;

    this.eventEmitter?.emit("tool:call", {
      name: toolCall.name,
      args: toolCall.arguments,
      callId: toolCall.id,
    });

    // Emission is synchronous, so a tool:call listener runs - and can start a
    // new turn - before the handler this event announces.
    if (isCancelled()) {
      return { executed: false };
    }

    try {
      const tool = this.toolRegistry.get(toolCall.name);
      if (!tool) {
        throw new Error(`No LLM tool registered for "${toolCall.name}"`);
      }

      validateToolArguments(tool.definition, toolCall.arguments, "LLM tool");

      const result = await withToolTimeout(
        tool.handler(toolCall.arguments, {
          character: this.character,
          callId: toolCall.id,
        }),
        tool.timeoutMs ?? this.defaultToolTimeoutMs,
        tool.definition.name,
        "LLM tool",
      );

      assertToolResultObject(result, tool.definition.name, "LLM tool");

      // Serialize inside the failure boundary: outputs that cannot be
      // represented as JSON (bigint values, circular references, a `toJSON()`
      // yielding a non-object) degrade to a failure output instead of aborting
      // the reply.
      outcome = snapshotToolResult(result, tool.definition.name, "LLM tool");
    } catch (error) {
      const failure = toError(error);
      this.eventEmitter?.emit("tool:error", {
        name: toolCall.name,
        error: failure,
        callId: toolCall.id,
      });
      return {
        executed: true,
        output: JSON.stringify(createToolFailureOutput(failure)),
      };
    }

    // The event and the projectors both receive the snapshot — the same value
    // the model's tool turn carries — so a tool result means one thing no
    // matter which modality executed it.
    this.eventEmitter?.emit("tool:result", {
      name: toolCall.name,
      output: outcome.snapshot,
      callId: toolCall.id,
    });
    this.projectToolResult(
      toolCall.name,
      outcome.snapshot,
      toolCall.id,
      isCancelled,
    );

    return { executed: true, output: outcome.serialized };
  }

  /**
   * Turn a successful tool result into avatar-style events. Projection is
   * skipped entirely without an event emitter, and a superseded turn projects
   * nothing further - its avatar state would land on top of the live turn's.
   */
  private projectToolResult(
    name: string,
    output: Record<string, unknown>,
    callId: string,
    isCancelled: () => boolean,
  ): void {
    const eventEmitter = this.eventEmitter;
    if (!eventEmitter) {
      return;
    }

    for (const projector of this.resultProjectors) {
      // Checked per projector, which is also the check for the projector that
      // just returned: any of them can supersede the turn.
      if (isCancelled()) {
        return;
      }

      try {
        projector({
          name,
          output,
          callId,
          emit: (event, payload) => {
            // Listeners run synchronously, so an earlier emission from this
            // same projector can supersede the turn mid-projection.
            if (isCancelled()) {
              return;
            }
            eventEmitter.emit(event, payload);
          },
        });
      } catch (error) {
        // A projector that superseded the turn and then threw belongs to a
        // stale turn: it reports no error either.
        if (isCancelled()) {
          return;
        }

        eventEmitter.emit("llm:error", {
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
): LLMManagerWithTools {
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
