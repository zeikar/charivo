import { Renderer, Message, Character } from '@charivo/core'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { inferMotionFromMessage, playMotion, animateExpression, playSafe } from './utils/motion'
import { setupResponsiveResize, type ResizeTeardown } from './utils/resize'

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.PIXI = PIXI
}

export class Live2DRenderer implements Renderer {
  private app?: PIXI.Application
  private model?: Live2DModel
  private messageCallback?: (message: Message, character?: Character) => void
  private teardownResize?: ResizeTeardown

  constructor(private canvas?: HTMLCanvasElement) {}

  setMessageCallback(callback: (message: Message, character?: Character) => void) {
    this.messageCallback = callback
  }

  async initialize(): Promise<void> {
    if (!this.canvas) throw new Error('Canvas element is required for Live2D rendering')

    const parent = this.canvas.parentElement
    const rect = parent?.getBoundingClientRect()
    const initialWidth = Math.floor(rect?.width || this.canvas.width || 400)
    const initialHeight = Math.floor(rect?.height || this.canvas.height || 600)

    this.app = new PIXI.Application({
      view: this.canvas,
      width: initialWidth,
      height: initialHeight,
      backgroundAlpha: 0,
      antialias: true,
    })

    this.teardownResize = setupResponsiveResize(this.canvas, () => {
      if (!this.app) return
      const parentEl = this.canvas!.parentElement
      if (!parentEl) return
      const { width, height } = parentEl.getBoundingClientRect()
      if (width > 0 && height > 0) {
        this.app.renderer.resize(Math.floor(width), Math.floor(height))
        this.positionAndScaleModel()
      }
    })
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!this.app) throw new Error('PIXI Application not initialized')

    if (this.model) {
      // @ts-ignore - pixi-live2d-display compatibility
      this.app.stage.removeChild(this.model)
      this.model.destroy()
    }

    if (typeof window !== 'undefined') {
      // @ts-ignore
      if (!window.Live2DCubismCore) {
        console.warn('⚠️ Live2DCubismCore not found. Ensure cubism4 core is loaded on the client.')
      }
    }

    this.model = await Live2DModel.from(modelPath)
    this.model.anchor.set(0.5, 0.5)
    this.positionAndScaleModel()
    // @ts-ignore - pixi-live2d-display compatibility
    this.app.stage.addChild(this.model)

    // Hit areas
    this.model.on('hit', (hitAreas) => {
      const lowered = hitAreas.map((h: string) => h.toLowerCase())
      if (lowered.includes('body')) {
        playSafe(this.model!, 'Tap@Body', 0, 1)
        playSafe(this.model!, 'Tap', 0, 1)
      }
    })

    // Idle loop
    playSafe(this.model, 'Idle', 0, 3)
  }

  private positionAndScaleModel(): void {
    if (!this.app || !this.model) return
    const { width, height } = this.app.screen
    this.model.x = width / 2
    this.model.y = height * 0.9
    const baseScale = Math.min(width / 2000, height / 3000)
    this.model.scale.set(Math.max(baseScale, 0.15))
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
      if (!this.model) return
      const motionType = inferMotionFromMessage(message.content)
      playMotion(this.model, motionType)
      if (this.model.internalModel) animateExpression(this.model, motionType)
    } else {
      console.log(`ℹ️ [${timestamp}] System: ${message.content}`)
    }
    this.messageCallback?.(message, character)
  }

  async destroy(): Promise<void> {
    if (this.app) {
      this.app.destroy(true)
    }
    this.teardownResize?.()
    this.teardownResize = undefined
  }
}

export function createLive2DRenderer(canvas?: HTMLCanvasElement): Live2DRenderer {
  return new Live2DRenderer(canvas)
}
