import { EventMap } from "./types";
export declare class EventBus {
  private listeners;
  on<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void;
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void;
  off<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void;
  clear(): void;
}
//# sourceMappingURL=bus.d.ts.map
