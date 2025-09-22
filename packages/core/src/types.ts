export interface Character {
  id: string
  name: string
  description?: string
  personality?: string
  avatar?: string
}

export interface Message {
  id: string
  content: string
  timestamp: Date
  characterId?: string
  type: 'user' | 'character' | 'system'
}

export interface Conversation {
  id: string
  messages: Message[]
  characterId?: string
  createdAt: Date
  updatedAt: Date
}

export interface Plugin {
  id: string
  name: string
  version: string
  enabled: boolean
}

export interface CharivoConfig {
  characters: Character[]
  plugins: Plugin[]
  llmProvider?: string
  renderProvider?: string
}

export interface LLMAdapter {
  generate(prompt: string, characterId?: string): Promise<string>
}

export interface Renderer {
  render(message: Message, character?: Character): Promise<void>
  initialize(): Promise<void>
  destroy(): Promise<void>
}

export type EventMap = {
  'message:sent': { message: Message }
  'message:received': { message: Message }
  'character:speak': { character: Character, message: string }
  'error': { error: Error }
}