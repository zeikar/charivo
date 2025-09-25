import { LLMAdapter, Character, Message } from '@charivo/core'

export class StubLLMAdapter implements LLMAdapter {
  private responses: string[] = [
    '안녕하세요! 저는 테스트용 캐릭터입니다.',
    '오늘 날씨가 정말 좋네요!',
    '무엇을 도와드릴까요?',
    '흥미로운 질문이네요. 더 자세히 알려주실 수 있나요?',
    '네, 알겠습니다!',
    '그렇군요. 재미있는 이야기네요.',
    '저도 그렇게 생각해요.',
    '음... 그건 어려운 질문이네요.',
  ]

  private responseIndex = 0
  private character: Character | null = null

  setCharacter(character: Character): void {
    this.character = character
  }

  clearHistory(): void {
    // Stub에서는 히스토리를 관리하지 않으므로 아무것도 하지 않음
    this.character
  }

  async generateResponse(_message: Message): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 500))

    const response = this.responses[this.responseIndex % this.responses.length]
    this.responseIndex++

    return response
  }
}
