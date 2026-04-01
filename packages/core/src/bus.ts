import { CharivoEventBus, EventMap } from "./types";

type ListenerStore = {
  [K in keyof EventMap]?: Array<(data: EventMap[K]) => void>;
};

export class EventBus implements CharivoEventBus {
  private listeners: ListenerStore = {};

  on<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void {
    this.listeners[event] ??= [];
    this.listeners[event]!.push(listener);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.listeners[event]?.forEach((listener) => listener(data));
  }

  off<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void {
    const eventListeners = this.listeners[event];
    if (!eventListeners) {
      return;
    }

    const index = eventListeners.indexOf(listener);
    if (index > -1) {
      eventListeners.splice(index, 1);
    }

    if (eventListeners.length === 0) {
      delete this.listeners[event];
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
