import { Renderer, Message, Character } from '@charivo/core'

export class Live2DRenderer implements Renderer {
  private _character?: Character
  private _modelPath?: string
  private canvas?: HTMLCanvasElement
  private messageCallback?: (message: Message, character?: Character) => void

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas
  }

  setMessageCallback(
    callback: (message: Message, character?: Character) => void
  ) {
    this.messageCallback = callback
  }

  async initialize(): Promise<void> {
    console.log('🎭 Live2DRenderer initialized')
    // Live2D 초기화 로직
    if (this.canvas) {
      console.log('Canvas element ready:', this.canvas)
    }
  }

  async loadModel(modelPath: string): Promise<void> {
    this._modelPath = modelPath
    console.log('🎮 Loading Live2D model:', modelPath)
    // 실제 Live2D 모델 로딩 로직
    await new Promise(resolve => setTimeout(resolve, 1000)) // 로딩 시뮬레이션
    console.log('✅ Live2D model loaded successfully')
  }

  setCharacter(character: Character): void {
    this._character = character
    console.log('👤 Character set:', character.name)
  }

  async render(message: Message, character?: Character): Promise<void> {
    const timestamp = message.timestamp.toLocaleTimeString()

    if (message.type === 'user') {
      console.log(`👤 [${timestamp}] User: ${message.content}`)
      // 사용자 메시지에는 특별한 애니메이션 없음
    } else if (message.type === 'character' && character) {
      console.log(`🎭 [${timestamp}] ${character.name}: ${message.content}`)

      // Live2D 캐릭터 애니메이션
      this.animateCharacter(message.content, character)
    } else {
      console.log(`ℹ️ [${timestamp}] System: ${message.content}`)
    }

    // 웹 UI 콜백
    if (this.messageCallback) {
      this.messageCallback(message, character)
    }
  }

  private animateCharacter(message: string, character: Character): void {
    console.log(`🎪 Animating ${character.name} for message: "${message}"`)
    console.log(`🎮 Using model: ${this._modelPath || 'default'}`)
    console.log(`👤 Character info:`, this._character)

    // 메시지 내용에 따른 애니메이션 선택
    if (message.includes('안녕') || message.includes('hello')) {
      this.playAnimation('greeting')
    } else if (message.includes('좋') || message.includes('기쁘')) {
      this.playAnimation('happy')
    } else if (message.includes('어려') || message.includes('힘들')) {
      this.playAnimation('thinking')
    } else {
      this.playAnimation('talk')
    }
  }

  private playAnimation(animationType: string): void {
    console.log(`🎬 Playing animation: ${animationType}`)

    if (this.canvas) {
      // 실제 Live2D 애니메이션 로직
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        // 간단한 시각적 피드백
        ctx.fillStyle = this.getAnimationColor(animationType)
        ctx.fillRect(0, 0, 50, 50)

        // 애니메이션 지속시간 후 클리어
        setTimeout(() => {
          ctx.clearRect(0, 0, this.canvas!.width, this.canvas!.height)
        }, 1000)
      }
    }
  }

  private getAnimationColor(type: string): string {
    switch (type) {
      case 'greeting':
        return '#4CAF50' // 초록
      case 'happy':
        return '#FFD700' // 금색
      case 'thinking':
        return '#9C27B0' // 보라
      default:
        return '#2196F3' // 파랑
    }
  }

  async destroy(): Promise<void> {
    console.log('🎭 Live2DRenderer destroyed')
    if (this.canvas) {
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      }
    }
  }
}

export function createLive2DRenderer(
  canvas?: HTMLCanvasElement
): Live2DRenderer {
  return new Live2DRenderer(canvas)
}
