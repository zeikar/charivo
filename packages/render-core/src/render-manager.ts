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
    console.log("🎯 RenderManager: Event bus connected - setting up listeners");

    // Listen for TTS audio events
    eventBus.on(
      "tts:audio:start",
      (data: { audioElement: HTMLAudioElement; characterId?: string }) => {
        console.log(
          "🎵 RenderManager: ✅ RECEIVED tts:audio:start event",
          data,
        );
        this.startRealtimeLipSync(data.audioElement, data.characterId);
      },
    );

    eventBus.on("tts:audio:end", (data: { characterId?: string }) => {
      console.log("🔇 RenderManager: ✅ RECEIVED tts:audio:end event", data);
      this.stopRealtimeLipSync();
    });

    eventBus.on(
      "tts:lipsync:update",
      (data: { rms: number; characterId?: string }) => {
        this.updateLipSync(data.rms);
      },
    );

    console.log("🎯 RenderManager: All event listeners registered");
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
    console.log("👤 RenderManager: Character set:", character.name);
    this.character = character;
    if (this.renderer.setCharacter) {
      this.renderer.setCharacter(character);
    }
  }

  /**
   * 현재 캐릭터 반환
   */
  getCharacter(): Character | null {
    return this.character;
  }

  /**
   * 렌더러 초기화
   */
  async initialize(): Promise<void> {
    await this.renderer.initialize();
  }

  /**
   * 모델 로드 (Live2D 전용, 옵션)
   */
  async loadModel(modelPath: string): Promise<void> {
    if (
      "loadModel" in this.renderer &&
      typeof this.renderer.loadModel === "function"
    ) {
      await this.renderer.loadModel(modelPath);
    }
  }

  /**
   * 메시지 렌더링
   */
  async render(message: Message, character?: Character): Promise<void> {
    const timestamp = message.timestamp.toLocaleTimeString();

    if (message.type === "user") {
      console.log(`👤 [${timestamp}] User: ${message.content}`);
    } else if (message.type === "character" && (character || this.character)) {
      const displayCharacter = character || this.character!;
      console.log(
        `🎭 [${timestamp}] ${displayCharacter.name}: ${message.content}`,
      );

      // 모션 및 표정 제어
      const motionType = inferMotionFromMessage(message.content);
      this.playMotion(motionType);
      this.animateExpression(motionType);
    } else {
      console.log(`ℹ️ [${timestamp}] System: ${message.content}`);
    }

    // 렌더러에 전달
    await this.renderer.render(
      message,
      character || this.character || undefined,
    );

    // 콜백 호출
    this.messageCallback?.(message, character || this.character || undefined);
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
  private startRealtimeLipSync(
    audioElement: HTMLAudioElement,
    characterId?: string,
  ): void {
    console.log("🎤 RenderManager: Starting realtime lip sync", {
      audioElement: audioElement?.tagName,
      characterId,
    });

    if (this.renderer.setRealtimeLipSync) {
      this.renderer.setRealtimeLipSync(true);
      console.log("✅ RenderManager: Renderer set to realtime lip sync mode");
    }

    this.lipSync.connectToAudio(audioElement, (rms: number) => {
      if (rms > 0.1) {
        console.log(`📊 RenderManager: RMS update: ${rms.toFixed(3)}`);
      }
      if (this.renderer.updateRealtimeLipSyncRms) {
        this.renderer.updateRealtimeLipSyncRms(rms);
      }
    });
  }

  /**
   * 실시간 립싱크 중지
   */
  private stopRealtimeLipSync(): void {
    console.log("🛑 RenderManager: Stopping realtime lip sync");

    if (this.renderer.setRealtimeLipSync) {
      this.renderer.setRealtimeLipSync(false);
    }

    this.lipSync.stop();
    console.log("✅ RenderManager: Lip sync stopped");
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
