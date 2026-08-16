import { CharivoEventBus, EventMap } from "./types";

type ListenerStore = {
  [K in keyof EventMap]?: Array<(data: EventMap[K]) => void>;
};

export class EventBus implements CharivoEventBus {
  // Object.create(null), not {}: EventMap is open to declaration merging, so
  // an augmented event may be named after an Object.prototype member
  // ("constructor", "toString", ...). On a prototype-backed store those keys
  // inherit a truthy value, so `??=` skips the array init and on()/emit()
  // throw. A null-prototype store has no inherited keys.
  private listeners: ListenerStore = Object.create(null);

  on<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void {
    this.listeners[event] ??= [];
    this.listeners[event]!.push(listener);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    // Each listener is isolated: one that throws must not stop the listeners
    // queued behind it, and emit() must stay non-throwing for its callers,
    // which are frequently mid-teardown or inside a provider callback.
    // Iterate a snapshot: a listener that calls off() mid-emit (e.g.
    // RenderManager.disconnect() removing six at once) splices the live
    // array, which would shift the next listener out of this dispatch.
    [...(this.listeners[event] ?? [])].forEach((listener) => {
      try {
        listener(data);
      } catch (error) {
        console.error(`Event listener for "${String(event)}" threw:`, error);
      }
    });
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
    this.listeners = Object.create(null);
  }
}
