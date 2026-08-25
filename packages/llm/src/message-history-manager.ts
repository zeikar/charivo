import { Message } from "@charivo/core";

export interface MessageHistoryManagerOptions {
  maxMessages?: number | null;
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
  private writeCount = 0;
  private readonly maxMessages?: number;

  constructor(options: MessageHistoryManagerOptions = {}) {
    if (
      options.maxMessages !== undefined &&
      options.maxMessages !== null &&
      (!Number.isInteger(options.maxMessages) || options.maxMessages <= 0)
    ) {
      throw new TypeError("maxMessages must be a positive integer or null");
    }

    this.maxMessages =
      options.maxMessages === null ? undefined : options.maxMessages;
  }

  add(message: Message, options: AddMessageOptions = {}): void {
    this.history.push(message);
    this.writeCount += 1;

    if (options.prune !== false) {
      this.pruneToBound();
    }
  }

  removeLast(): Message | undefined {
    const removed = this.history.pop();

    if (removed !== undefined) {
      this.writeCount += 1;
    }

    return removed;
  }

  /**
   * Remove the entry that *is* the given object and report whether it was
   * found. Reference identity, not id: overlapping turns can carry duplicate
   * ids, so an id lookup can drop another turn's message.
   */
  remove(message: Message): boolean {
    const index = this.history.indexOf(message);

    if (index === -1) {
      return false;
    }

    this.history.splice(index, 1);
    this.writeCount += 1;
    return true;
  }

  /** Reference-identity membership check, matching remove(). */
  contains(message: Message): boolean {
    return this.history.includes(message);
  }

  /** Put previously evicted entries back at the head, in their original order. */
  restoreToHead(messages: Message[]): void {
    if (messages.length === 0) {
      return;
    }

    this.history.unshift(...messages);
    this.writeCount += 1;
  }

  clear(): void {
    this.history = [];
    this.writeCount += 1;
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

  /** Monotonic counter of the write attempts this store has taken. */
  getWriteCount(): number {
    return this.writeCount;
  }

  /**
   * Prune in one step, down to the exact bound, and report what was
   * evicted in its original order.
   */
  pruneToBound(): Message[] {
    if (
      this.maxMessages === undefined ||
      this.history.length <= this.maxMessages
    ) {
      return [];
    }

    const evicted = this.history.splice(
      0,
      this.history.length - this.maxMessages,
    );
    this.writeCount += 1;
    return evicted;
  }

  /** Drop the leading character messages and report them in their original order. */
  removeLeadingCharacterMessages(): Message[] {
    let count = 0;
    // Stop before the last entry: the newest message is never a stranded reply.
    while (
      count < this.history.length - 1 &&
      this.history[count].type === "character"
    ) {
      count += 1;
    }

    if (count === 0) {
      return [];
    }

    const removed = this.history.splice(0, count);
    this.writeCount += 1;
    return removed;
  }
}
