import { Renderer, Message, Character } from '@charivo/core'

export class ConsoleRenderer implements Renderer {
  async initialize(): Promise<void> {
    console.log('🎭 ConsoleRenderer initialized')
  }

  async render(message: Message, character?: Character): Promise<void> {
    const timestamp = message.timestamp.toLocaleTimeString()

    if (message.type === 'user') {
      console.log(`👤 [${timestamp}] User: ${message.content}`)
    } else if (message.type === 'character' && character) {
      console.log(`🎭 [${timestamp}] ${character.name}: ${message.content}`)
    } else {
      console.log(`ℹ️ [${timestamp}] System: ${message.content}`)
    }
  }

  async destroy(): Promise<void> {
    console.log('🎭 ConsoleRenderer destroyed')
  }
}