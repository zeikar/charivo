import { Renderer, Message, Character } from '@charivo/core'
import * as PIXI from 'pixi.js'
// pixi-live2d-display v0.4 uses default export path
import { Live2DModel } from 'pixi-live2d-display/cubism4'

// expose PIXI to window so that this plugin is able to
// reference window.PIXI.Ticker to automatically update Live2D models
// Only touch window in the browser
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.PIXI = PIXI
}

// Note: If the Live2D Cubism Core (for Cubism 4) is not available at runtime,
// pixi-live2d-display will fail to create the model. Make sure the app loads
// the Cubism core (via the cubism4 plugin above or a global script) on the client.

export class Live2DRenderer implements Renderer {
  private app?: PIXI.Application
  private model?: Live2DModel
  private messageCallback?: (message: Message, character?: Character) => void
  private resizeObserver?: ResizeObserver

  constructor(private canvas?: HTMLCanvasElement) {}

  setMessageCallback(callback: (message: Message, character?: Character) => void) {
    this.messageCallback = callback
  }

  async initialize(): Promise<void> {
    console.log('🎭 Live2DRenderer initializing...')

    if (!this.canvas) {
      throw new Error('Canvas element is required for Live2D rendering')
    }

    try {
      // PIXI Application 생성
      const parent = this.canvas.parentElement
      const rect = parent?.getBoundingClientRect()
      const initialWidth = Math.floor(rect?.width || this.canvas.width || 400)
      const initialHeight = Math.floor(rect?.height || this.canvas.height || 600)

      this.app = new PIXI.Application({
        view: this.canvas,
        // Use container/canvas size when available
        width: initialWidth,
        height: initialHeight,
        backgroundAlpha: 0,
        antialias: true,
      })

  console.log('✅ PIXI Application created')

      // Fit to container size (if any)
      this.setupResponsiveResize()
    } catch (error) {
      console.error('❌ Failed to initialize Live2D renderer:', error)
      throw error
    }
  }

  async loadModel(modelPath: string): Promise<void> {
    console.log('🎮 Loading Live2D model:', modelPath)

    if (!this.app) {
      throw new Error('PIXI Application not initialized')
    }

    try {
      // 기존 모델 제거
      if (this.model) {
        // @ts-ignore - pixi-live2d-display compatibility
        this.app.stage.removeChild(this.model)
        this.model.destroy()
      }

      // Live2D 모델 로드
      if (typeof window !== 'undefined') {
        // @ts-ignore
        if (!window.Live2DCubismCore) {
          console.warn('⚠️ Live2DCubismCore is not found on window. Ensure cubism4 core is loaded on the client.')
        }
      }
      this.model = await Live2DModel.from(modelPath)

      // 모델 크기 조정 및 위치 설정
      this.model.anchor.set(0.5, 0.5)
      this.positionAndScaleModel()

      // 스테이지에 모델 추가
      // @ts-ignore - pixi-live2d-display compatibility
      this.app.stage.addChild(this.model)

      console.log('✅ Live2D model loaded successfully')

      // 기본 애니메이션 시작
      if (this.model) {
        // 인터랙션 이벤트 설정
        this.model.on('hit', (hitAreas) => {
          console.log('🎯 Hit areas:', hitAreas)
          const lowered = hitAreas.map((h: string) => h.toLowerCase())
          if (lowered.includes('body')) {
            // Common patterns: 'Tap@Body' or fallback 'Tap'
            this.safePlayMotion('Tap@Body', 0, 1)
            this.safePlayMotion('Tap', 0, 1)
          }
        })

        // 기본 idle 모션 시작
        // Typical motion group name is 'Idle'
        this.safePlayMotion('Idle', 0, 3)
      }

      // Re-check responsive sizing in case the canvas was appended after initialization
      this.setupResponsiveResize()

    } catch (error) {
      console.error('❌ Failed to load Live2D model:', error)
      this.showErrorPlaceholder()
    }
  }

  private setupResponsiveResize(): void {
    if (!this.canvas || !this.app) return

    const resize = () => {
      if (!this.app) return
      const parent = this.canvas?.parentElement
      if (!parent) return
      const { width, height } = parent.getBoundingClientRect()
      if (width > 0 && height > 0) {
        this.app.renderer.resize(Math.floor(width), Math.floor(height))
        this.positionAndScaleModel()
      }
    }

    // Initial run
    setTimeout(resize, 0)

    // Observe parent size changes
    try {
      this.resizeObserver = new ResizeObserver(() => resize())
      if (this.canvas.parentElement) {
        this.resizeObserver.observe(this.canvas.parentElement)
      } else {
        // If not yet attached, watch DOM mutations briefly to attach when available
        const mo = new MutationObserver(() => {
          if (this.canvas?.parentElement) {
            this.resizeObserver?.observe(this.canvas.parentElement)
            resize()
            mo.disconnect()
          }
        })
        mo.observe(document.body, { childList: true, subtree: true })
      }
    } catch {
      // Fallback to window resize
      window.addEventListener('resize', resize)
    }
  }

  private positionAndScaleModel(): void {
    if (!this.app || !this.model) return
    const { width, height } = this.app.screen
    this.model.x = width / 2
    // place near bottom to show more of the face
    this.model.y = height * 0.9

    // Heuristic scaling: fit width while keeping aspect
    const baseScale = Math.min(width / 2000, height / 3000) // tuned for many models
    this.model.scale.set(Math.max(baseScale, 0.15))
  }

  private showErrorPlaceholder(): void {
    if (!this.app) return

    // 에러 표시를 위한 간단한 플레이스홀더
    const graphics = new PIXI.Graphics()
    graphics.beginFill(0xff6b6b)
    graphics.drawRect(0, 0, 100, 150)
    graphics.endFill()
    graphics.x = this.app.screen.width / 2 - 50
    graphics.y = this.app.screen.height / 2 - 75

    // Pixi v6 typings require DisplayObject; Graphics extends it at runtime but TS may mismatch.
    this.app.stage.addChild(graphics as unknown as PIXI.DisplayObject)
  }

  setCharacter(character: Character): void {
    console.log('👤 Character set:', character.name)
  }

  async render(message: Message, character?: Character): Promise<void> {
    const timestamp = message.timestamp.toLocaleTimeString()

    if (message.type === 'user') {
      console.log(`👤 [${timestamp}] User: ${message.content}`)
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

    if (!this.model) {
      console.log('⚠️ No Live2D model loaded, skipping animation')
      return
    }

    // 메시지 내용에 따른 애니메이션 선택
    if (message.includes('안녕') || message.includes('hello')) {
      this.playLive2DMotion('greeting')
    } else if (message.includes('좋') || message.includes('기쁘')) {
      this.playLive2DMotion('happy')
    } else if (message.includes('어려') || message.includes('힘들')) {
      this.playLive2DMotion('thinking')
    } else {
      this.playLive2DMotion('talk')
    }
  }

  private playLive2DMotion(motionType: string): void {
    console.log(`🎬 Playing Live2D motion: ${motionType}`)

    if (!this.model) return

    try {
      // Live2D 모션 재생
      switch (motionType) {
        case 'greeting':
          // 인사 모션 (있다면)
          this.safePlayMotion('Tap@Body', 0, 1)
          this.safePlayMotion('Tap', 0, 1)
          break
        case 'happy':
          // 기쁨 모션
          this.safePlayMotion('Flick', 0, 1)
          break
        case 'thinking':
          // 생각 모션
          this.safePlayMotion('Idle', 1, 1)
          break
        default:
          // 기본 말하기 모션
          this.safePlayMotion('Idle', 0, 1)
          break
      }

      // 표정도 변경 (만약 표정 변경을 지원한다면)
      if (this.model.internalModel) {
        this.animateExpression(motionType)
      }

    } catch (error) {
      console.error('❌ Failed to play Live2D motion:', error)
    }
  }

  private safePlayMotion(group: string, index = 0, priority?: number) {
    try {
      this.model?.motion(group, index, priority)
    } catch (e) {
      console.log(`ℹ️ Motion group not found: ${group}[${index}]`)
    }
  }

  private animateExpression(motionType: string): void {
    if (!this.model) return

    try {
      // 표정 애니메이션
      switch (motionType) {
        case 'greeting':
        case 'happy':
          this.model.expression('smile')
          break
        case 'thinking':
          this.model.expression('surprised')
          break
        default:
          this.model.expression('normal')
          break
      }
    } catch (error) {
      // 표정 변경이 지원되지 않는 모델일 수 있음
      console.log('ℹ️ Expression change not supported for this model')
    }
  }

  async destroy(): Promise<void> {
    console.log('🎭 Live2DRenderer destroyed')
    if (this.app) {
      this.app.destroy(true)
    }
    if (this.resizeObserver && this.canvas?.parentElement) {
      try {
        this.resizeObserver.unobserve(this.canvas.parentElement)
      } catch {}
    }
  }
}

export function createLive2DRenderer(canvas?: HTMLCanvasElement): Live2DRenderer {
  return new Live2DRenderer(canvas)
}