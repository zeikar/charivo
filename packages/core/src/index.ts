// Types
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

// Core class
export class CharivoCore {
  constructor() {
    console.log('CharivoCore initialized')
  }

  async initialize() {
    // Core initialization logic
  }
}