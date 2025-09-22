import { EventBus } from './bus'
import { Character, Message, LLMAdapter, Renderer } from './types'

export * from './types'
export * from './bus'

export class Charivo {
  private eventBus: EventBus
  private llmAdapter?: LLMAdapter
  private renderer?: Renderer
  private characters: Map<string, Character> = new Map()

  constructor() {
    this.eventBus = new EventBus()
  }

  attachRenderer(renderer: Renderer): void {
    this.renderer = renderer
  }

  attachLLM(adapter: LLMAdapter): void {
    this.llmAdapter = adapter
  }

  addCharacter(character: Character): void {
    this.characters.set(character.id, character)
  }

  async userSay(content: string, characterId?: string): Promise<void> {
    const userMessage: Message = {
      id: Date.now().toString(),
      content,
      timestamp: new Date(),
      type: 'user'
    }

    this.eventBus.emit('message:sent', { message: userMessage })

    if (this.renderer) {
      await this.renderer.render(userMessage)
    }

    if (this.llmAdapter && characterId) {
      const character = this.characters.get(characterId)
      if (character) {
        const response = await this.llmAdapter.generate(content, characterId)

        const characterMessage: Message = {
          id: Date.now().toString() + '_response',
          content: response,
          timestamp: new Date(),
          characterId,
          type: 'character'
        }

        this.eventBus.emit('message:received', { message: characterMessage })
        this.eventBus.emit('character:speak', { character, message: response })

        if (this.renderer) {
          await this.renderer.render(characterMessage, character)
        }
      }
    }
  }

  on<K extends keyof import('./types').EventMap>(event: K, listener: (data: import('./types').EventMap[K]) => void): void {
    this.eventBus.on(event, listener)
  }

  emit<K extends keyof import('./types').EventMap>(event: K, data: import('./types').EventMap[K]): void {
    this.eventBus.emit(event, data)
  }
}