import {
  LLMClient,
  Message,
  Character,
  toCharivoError,
  type LLMManager as CoreLLMManager,
} from "@charivo/core";
import { MessageHistoryManager } from "./message-history-manager";
import { CharacterPromptBuilder } from "./character-prompt-builder";
import { MessageConverter } from "./message-converter";
import { LLMValidators } from "./validators";
import { ResponseMessageBuilder } from "./response-message-builder";

const DEFAULT_MAX_HISTORY_TURNS = 40;

export interface LLMManagerOptions {
  maxHistoryTurns?: number | null;
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
  private character: Character | null = null;

  constructor(
    private llmClient: LLMClient,
    options: LLMManagerOptions = {},
  ) {
    this.maxHistoryMessages = resolveMaxHistoryMessages(options);
    this.historyManager = new MessageHistoryManager({
      maxMessages: this.maxHistoryMessages,
      pruneBatchSize: 2,
    });
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
      const assistantMessage = await this.llmClient.call(apiMessages);

      // Build the AI response message and add it to the history
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
   * Prepare messages for the LLM API call
   */
  private prepareApiMessages(
    messages: Message[],
  ): Array<{ role: string; content: string }> {
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
