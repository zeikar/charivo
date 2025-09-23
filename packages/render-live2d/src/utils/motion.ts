import type { Live2DModel } from 'pixi-live2d-display/cubism4'

export type MotionType = 'greeting' | 'happy' | 'thinking' | 'talk'

export function inferMotionFromMessage(text: string): MotionType {
  if (text.includes('안녕') || text.toLowerCase().includes('hello')) return 'greeting'
  if (text.includes('좋') || text.includes('기쁘')) return 'happy'
  if (text.includes('어려') || text.includes('힘들')) return 'thinking'
  return 'talk'
}

export function playSafe(model: Live2DModel, group: string, index = 0, priority?: number) {
  try {
    model.motion(group, index, priority)
  } catch {
    // swallow and log via caller if desired
  }
}

export function playMotion(model: Live2DModel, motionType: MotionType) {
  switch (motionType) {
    case 'greeting':
      playSafe(model, 'Tap@Body', 0, 1)
      playSafe(model, 'Tap', 0, 1)
      break
    case 'happy':
      playSafe(model, 'Flick', 0, 1)
      break
    case 'thinking':
      playSafe(model, 'Idle', 1, 1)
      break
    default:
      playSafe(model, 'Idle', 0, 1)
      break
  }
}

export function animateExpression(model: Live2DModel, motionType: MotionType) {
  try {
    switch (motionType) {
      case 'greeting':
      case 'happy':
        model.expression('smile')
        break
      case 'thinking':
        model.expression('surprised')
        break
      default:
        model.expression('normal')
        break
    }
  } catch {
    // expression may not be supported
  }
}
