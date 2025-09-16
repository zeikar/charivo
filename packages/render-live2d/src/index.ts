import type { Character } from '@charivo/core'

export interface Live2DRenderer {
  loadModel(modelPath: string): Promise<void>
  setCharacter(character: Character): void
  render(): void
  dispose(): void
}

export class Live2DRenderEngine implements Live2DRenderer {
  private character?: Character

  async loadModel(modelPath: string): Promise<void> {
    // Load Live2D model implementation
    console.log('Loading Live2D model:', modelPath)
  }

  setCharacter(character: Character): void {
    this.character = character
  }

  render(): void {
    if (!this.character) return
    // Render Live2D character
    console.log('Rendering character:', this.character.name)
  }

  dispose(): void {
    // Cleanup resources
  }
}

export function createLive2DRenderer(): Live2DRenderer {
  return new Live2DRenderEngine()
}