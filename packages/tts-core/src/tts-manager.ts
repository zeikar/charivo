import { TTSPlayer, TTSOptions, TTSManager } from "@charivo/core";

/**
 * TTS Manager - TTS 세션의 상태 관리를 담당하는 클래스
 *
 * 역할:
 * - TTS Player 관리 및 래핑
 * - 이벤트 발신자 연결
 * - 세션 상태 관리
 * - 통합 인터페이스 제공
 */
export class TTSManagerImpl implements TTSManager {
  private ttsPlayer: TTSPlayer;
  private eventEmitter?: { emit: (event: string, data: any) => void };

  constructor(ttsPlayer: TTSPlayer) {
    this.ttsPlayer = ttsPlayer;
  }

  /**
   * 이벤트 발신자 설정
   */
  setEventEmitter(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void {
    console.log("🔗 TTS Manager: Event emitter connected");
    this.eventEmitter = eventEmitter;
    this.setupTTSPlayer();
  }

  /**
   * 텍스트 음성 변환 및 재생
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    return this.ttsPlayer.speak(text, options);
  }

  /**
   * 재생 중지
   */
  async stop(): Promise<void> {
    return this.ttsPlayer.stop();
  }

  /**
   * 음성 설정
   */
  setVoice(voice: string): void {
    this.ttsPlayer.setVoice(voice);
  }

  /**
   * 지원 여부 확인
   */
  isSupported(): boolean {
    return this.ttsPlayer.isSupported();
  }

  /**
   * TTS Player에 이벤트 발신자 연결
   */
  private setupTTSPlayer(): void {
    if (!this.eventEmitter) return;

    // TTS Player가 setEventEmitter를 지원하는 경우 연결
    if (
      "setEventEmitter" in this.ttsPlayer &&
      typeof (this.ttsPlayer as any).setEventEmitter === "function"
    ) {
      console.log("🔗 TTS Manager: Connecting event emitter to TTS Player");
      (this.ttsPlayer as any).setEventEmitter(this.eventEmitter);
    } else {
      console.warn("⚠️ TTS Manager: TTS Player doesn't support event emitter", {
        playerType: this.ttsPlayer.constructor.name,
        hasSetEventEmitter: "setEventEmitter" in this.ttsPlayer,
      });
    }
  }
}

/**
 * TTS Manager 생성 헬퍼 함수
 */
export function createTTSManager(ttsPlayer: TTSPlayer): TTSManager {
  return new TTSManagerImpl(ttsPlayer);
}
