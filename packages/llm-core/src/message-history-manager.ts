import { Message } from "@charivo/core";

/**
 * 메시지 히스토리 관리
 */
export class MessageHistoryManager {
  private history: Message[] = [];

  add(message: Message): void {
    this.history.push(message);
  }

  removeLast(): Message | undefined {
    return this.history.pop();
  }

  clear(): void {
    this.history = [];
  }

  getAll(): Message[] {
    return [...this.history]; // 복사본 반환
  }

  size(): number {
    return this.history.length;
  }
}
