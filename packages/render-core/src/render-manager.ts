import {
  Renderer,
  Message,
  Character,
  MotionType,
  RenderManager as IRenderManager,
} from "@charivo/core";
import { RealTimeLipSync } from "./lipsync";
import { inferMotionFromMessage } from "./motion-inference";

/**
 * Render Manager - 렌더링 세션의 상태 관리를 담당하는 클래스
 *
 * 역할:
 * - 렌더러 관리 및 래핑
 * - 이벤트 버스 연결 및 이벤트 처리
 * - 립싱크 처리 및 좌표
 * - 모션 및 표현 제어
 * - 캐릭터 설정 관리
 * - 메시지 렌더링 조율
 *
 * RenderManager는 어떤 Renderer든 받을 수 있으며,
 * 렌더러가 지원하는 기능(motion, lipsync 등)을 선택적으로 사용합니다.
 */
export class RenderManager implements IRenderManager {
  private renderer: Renderer;
  private character: Character | null = null;
  private lipSync = new RealTimeLipSync();
  private messageCallback?: (message: Message, character?: Character) => void;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
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
    // Character message일 때 모션 및 표정 제어
    if (message.type === "character" && (character || this.character)) {
      const motionType = inferMotionFromMessage(message.content);
      this.playMotion(motionType);
      this.animateExpression(motionType);
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
   * 모션 재생
   */
  private playMotion(motionType: MotionType): void {
    if (this.renderer.playMotion) {
      this.renderer.playMotion(motionType);
    }
  }

  /**
   * 표정 애니메이션
   */
  private animateExpression(motionType: MotionType): void {
    if (this.renderer.animateExpression) {
      this.renderer.animateExpression(motionType);
    }
  }
}

/**
 * Render Manager 생성 헬퍼 함수
 */
export function createRenderManager(renderer: Renderer): RenderManager {
  return new RenderManager(renderer);
}
