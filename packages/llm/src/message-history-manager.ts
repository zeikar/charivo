import { Message } from "@charivo/core";

export interface MessageHistoryManagerOptions {
  maxMessages?: number | null;
  pruneBatchSize?: number;
}

export interface AddMessageOptions {
  /**
   * Internal escape hatch for workflows that need multiple appends to become
   * visible as one pruning boundary, such as user/assistant turn pairs.
   */
  prune?: boolean;
}

/**
 * Message history management
 */
export class MessageHistoryManager {
  private history: Message[] = [];
  private readonly maxMessages?: number;
  private readonly pruneBatchSize: number;

  constructor(options: MessageHistoryManagerOptions = {}) {
    if (
      options.maxMessages !== undefined &&
      options.maxMessages !== null &&
      (!Number.isInteger(options.maxMessages) || options.maxMessages <= 0)
    ) {
      throw new TypeError("maxMessages must be a positive integer or null");
    }

    if (
      options.pruneBatchSize !== undefined &&
      (!Number.isInteger(options.pruneBatchSize) || options.pruneBatchSize <= 0)
    ) {
      throw new TypeError("pruneBatchSize must be a positive integer");
    }

    this.maxMessages =
      options.maxMessages === null ? undefined : options.maxMessages;
    this.pruneBatchSize = options.pruneBatchSize ?? 1;
  }

  add(message: Message, options: AddMessageOptions = {}): void {
    this.history.push(message);

    if (options.prune !== false) {
      this.pruneToMax();
    }
  }

  removeLast(): Message | undefined {
    return this.history.pop();
  }

  clear(): void {
    this.history = [];
  }

  getAll(): Message[] {
    return [...this.history]; // Return a copy
  }

  getRecent(maxMessages?: number): Message[] {
    if (
      maxMessages !== undefined &&
      (!Number.isInteger(maxMessages) || maxMessages <= 0)
    ) {
      throw new TypeError("maxMessages must be a positive integer");
    }

    if (maxMessages === undefined || this.history.length <= maxMessages) {
      return this.getAll();
    }

    return this.history.slice(-maxMessages);
  }

  size(): number {
    return this.history.length;
  }

  pruneToMax(): void {
    if (this.maxMessages === undefined) {
      return;
    }

    while (this.history.length > this.maxMessages) {
      const excess = this.history.length - this.maxMessages;
      const removeCount = Math.min(
        Math.ceil(excess / this.pruneBatchSize) * this.pruneBatchSize,
        this.history.length,
      );
      this.history.splice(0, removeCount);
    }
  }
}
