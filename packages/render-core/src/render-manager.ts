import {
  Renderer,
  Message,
  Character,
  RenderManager as IRenderManager,
  Emotion,
} from "@charivo/core";
import { RealTimeLipSync } from "./lipsync";
import {
  setupMouseTracking,
  type MouseTrackable,
  type MouseTrackingCleanup,
  type MouseTrackingMode,
} from "./mouse-tracking";

/**
 * Render Manager - 렌더링 세션의 상태 관리를 담당하는 클래스
 *
 * 역할:
 * - 렌더러 관리 및 래핑
 * - 이벤트 버스 연결 및 이벤트 처리
 * - 립싱크 처리 및 조율
 * - 모션 및 표현 제어
 * - 마우스 추적 관리
 * - 캐릭터 설정 관리
 * - 메시지 렌더링 조율
 *
 * RenderManager는 어떤 Renderer든 받을 수 있으며,
 * 렌더러가 지원하는 기능(motion, lipsync, mouse tracking 등)을 선택적으로 사용합니다.
 */
export interface RenderManagerOptions {
  canvas?: HTMLCanvasElement;
  mouseTracking?: MouseTrackingMode;
}

export class RenderManager implements IRenderManager {
  private renderer: Renderer;
  private character: Character | null = null;
  private lipSync = new RealTimeLipSync();
  private messageCallback?: (message: Message, character?: Character) => void;
  private cleanupMouseTracking?: MouseTrackingCleanup;
  private options?: RenderManagerOptions;

  constructor(renderer: Renderer, options?: RenderManagerOptions) {
    this.renderer = renderer;
    this.options = options;
  }

  /**
   * 이벤트 버스 연결
   */
  setEventBus(eventBus: {
    on: (event: string, callback: (...args: any[]) => void) => void;
    emit: (event: string, data: any) => void;
  }): void {
    // TTS audio events
    eventBus.on(
      "tts:audio:start",
      (data: { audioElement: HTMLAudioElement; characterId?: string }) => {
        this.startRealtimeLipSync(data.audioElement);
      },
    );

    eventBus.on("tts:audio:end", () => {
      this.stopRealtimeLipSync();
    });

    eventBus.on(
      "tts:lipsync:update",
      (data: { rms: number; characterId?: string }) => {
        this.updateLipSync(data.rms);
      },
    );

    // Realtime emotion events
    eventBus.on(
      "realtime:emotion",
      (data: { emotion: string; intensity?: number; motion?: string }) => {
        this.handleRealtimeEmotion(data.emotion as Emotion);
      },
    );
  }

  /**
   * 메시지 콜백 설정
   */
  setMessageCallback(
    callback: (message: Message, character?: Character) => void,
  ): void {
    this.messageCallback = callback;
  }

  /**
   * 캐릭터 설정
   */
  setCharacter(character: Character): void {
    this.character = character;
  }

  /**
   * 렌더러 초기화
   */
  async initialize(): Promise<void> {
    await this.renderer.initialize();

    // MouseTrackable 렌더러인 경우 마우스 추적 설정
    if (this.isMouseTrackable(this.renderer) && this.options?.canvas) {
      this.cleanupMouseTracking = setupMouseTracking({
        canvas: this.options.canvas,
        mode: this.options.mouseTracking ?? "canvas",
        target: this.renderer,
      });
    }
  }

  /**
   * 렌더러가 MouseTrackable인지 확인
   */
  private isMouseTrackable(
    renderer: Renderer,
  ): renderer is Renderer & MouseTrackable {
    return (
      typeof (renderer as any).updateViewWithMouse === "function" &&
      typeof (renderer as any).handleMouseTap === "function"
    );
  }

  /**
   * 모델 로드 (렌더러가 지원하는 경우)
   */
  async loadModel(modelPath: string): Promise<void> {
    if (this.renderer.loadModel) {
      await this.renderer.loadModel(modelPath);
    }
  }

  /**
   * 메시지 렌더링
   */
  async render(message: Message, character?: Character): Promise<void> {
    // Character message일 때 감정 기반 애니메이션 재생
    if (
      message.type === "character" &&
      message.emotion &&
      (character || this.character)
    ) {
      const targetCharacter = character || this.character!;
      this.playEmotionAnimation(message.emotion, targetCharacter);
    }

    // 렌더러에 전달
    const targetCharacter = character || this.character || undefined;
    await this.renderer.render(message, targetCharacter);

    // 콜백 호출
    this.messageCallback?.(message, targetCharacter);
  }

  /**
   * 정리
   */
  async destroy(): Promise<void> {
    this.cleanupMouseTracking?.();
    this.cleanupMouseTracking = undefined;

    this.lipSync.cleanup();
    await this.renderer.destroy();
  }

  /**
   * 실시간 립싱크 시작
   */
  private startRealtimeLipSync(audioElement: HTMLAudioElement): void {
    if (this.renderer.setRealtimeLipSync) {
      this.renderer.setRealtimeLipSync(true);
    }

    this.lipSync.connectToAudio(audioElement, (rms: number) => {
      if (this.renderer.updateRealtimeLipSyncRms) {
        this.renderer.updateRealtimeLipSyncRms(rms);
      }
    });
  }

  /**
   * 실시간 립싱크 중지
   */
  private stopRealtimeLipSync(): void {
    this.lipSync.stop();

    if (this.renderer.setRealtimeLipSync) {
      this.renderer.setRealtimeLipSync(false);
    }
  }

  /**
   * 립싱크 RMS 업데이트
   */
  private updateLipSync(rms: number): void {
    if (this.renderer.updateRealtimeLipSyncRms) {
      this.renderer.updateRealtimeLipSyncRms(rms);
    }
  }

  /**
   * Realtime emotion 처리 (tool call로부터)
   */
  private handleRealtimeEmotion(emotion: Emotion): void {
    if (!this.character) {
      return;
    }

    this.playEmotionAnimation(emotion, this.character);
  }

  /**
   * 감정 기반 애니메이션 재생
   * Character에 커스텀 매핑이 있는 경우에만 재생
   */
  private playEmotionAnimation(emotion: Emotion, character: Character): void {
    // Find mapping for this emotion
    const mapping = character.emotionMappings?.find(
      (m) => m.emotion === emotion,
    );

    if (!mapping) {
      // 매핑이 없으면 아무것도 안 함
      return;
    }

    // Play expression if available
    if (mapping.expression && "playExpression" in this.renderer) {
      (this.renderer as any).playExpression(mapping.expression);
    }

    // Play motion if available
    if (mapping.motion && "playMotionByGroup" in this.renderer) {
      const { group, index = 0 } = mapping.motion;
      (this.renderer as any).playMotionByGroup(group, index);
    }

    console.log(
      `🎨 [Animation] ${emotion} → ${mapping.expression || "none"} + ${mapping.motion?.group || "none"}`,
    );
  }
}

/**
 * Render Manager 생성 헬퍼 함수
 */
export function createRenderManager(
  renderer: Renderer,
  options?: RenderManagerOptions,
): RenderManager {
  return new RenderManager(renderer, options);
}
