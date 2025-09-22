import { EventMap } from './types'

export class EventBus {
  private listeners: Map<keyof EventMap, Array<(data: any) => void>> = new Map()

  on<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(listener)
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.forEach(listener => listener(data))
    }
  }

  off<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): void {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      const index = eventListeners.indexOf(listener)
      if (index > -1) {
        eventListeners.splice(index, 1)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}