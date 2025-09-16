import OpenAI from 'openai'
import type { Message, Character } from '@charivo/core'

export interface LLMAdapter {
  generateResponse(messages: Message[], character: Character): Promise<string>
}

export class OpenAIAdapter implements LLMAdapter {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async generateResponse(messages: Message[], character: Character): Promise<string> {
    const systemPrompt = `You are ${character.name}. ${character.description || ''} ${character.personality || ''}`
    
    const openAIMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(msg => ({
        role: msg.type === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content
      }))
    ]

    const response = await this.client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: openAIMessages,
      temperature: 0.7,
    })

    return response.choices[0]?.message?.content || ''
  }
}

export function createOpenAIAdapter(apiKey: string): LLMAdapter {
  return new OpenAIAdapter(apiKey)
}