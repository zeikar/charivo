import { TTSPlayer, TTSOptions, TTSManager } from "@charivo/core";
import { WebSpeechLipSyncSimulator } from "./web-speech-lipsync-simulator";
import {
  detectTTSPlayerType,
  getMimeTypeForPlayer,
  supportsGenerateAudio,
  TTSPlayerType,
} from "./tts-utils";

/**
 * TTS Manager - TTS 세션의 상태 관리를 담당하는 클래스
 *
 * 역할:
 * - TTS Player 관리 및 래핑
 * - 오디오 재생 및 제어
 * - 립싱크 처리 (Web Speech 시뮬레이션, Audio는 Live2D SDK에서 자동 처리)
 * - 이벤트 발생 (tts:audio:start, tts:lipsync:update, tts:audio:end)
 * - 세션 상태 관리
 */
export class TTSManagerImpl implements TTSManager {
  private ttsPlayer: TTSPlayer;
  private eventEmitter?: { emit: (event: string, data: any) => void };
  private currentAudio: HTMLAudioElement | null = null;
  private playerType: TTSPlayerType;

  // Web Speech 립싱크 시뮬레이션만 필요
  private webSimulator: WebSpeechLipSyncSimulator;

  constructor(ttsPlayer: TTSPlayer) {
    this.ttsPlayer = ttsPlayer;
    this.playerType = detectTTSPlayerType(ttsPlayer);

    // Initialize Web Speech simulator
    this.webSimulator = new WebSpeechLipSyncSimulator();
  }

  /**
   * 이벤트 발신자 설정
   */
  setEventEmitter(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void {
    console.log("🔗 TTS Manager: Event emitter connected");
    this.eventEmitter = eventEmitter;

    // Connect event emitter to Web Speech simulator
    this.webSimulator = new WebSpeechLipSyncSimulator(eventEmitter);
  }

  /**
   * 텍스트 음성 변환 및 재생
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    await this.stop();

    if (this.playerType === "web") {
      return this.handleWebSpeech(text, options);
    } else {
      return this.handleAudioSpeech(text, options);
    }
  }

  /**
   * 현재 재생 중인 음성 중지
   */
  async stop(): Promise<void> {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
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
   * Web Speech API 처리 (시뮬레이션 립싱크)
   */
  private async handleWebSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    // Create dummy audio element for consistent interface
    const dummyAudio = document.createElement("audio");
    dummyAudio.preload = "none";

    // Emit audio start event
    this.eventEmitter?.emit("tts:audio:start", { audioElement: dummyAudio });

    // Start simulated lip sync using dedicated component
    this.webSimulator.startSimulation(text, options?.rate || 1);

    // Delegate to player and wait for completion
    return this.ttsPlayer.speak(text, options);
  }

  /**
   * Audio-based TTS 처리 (실시간 오디오 분석)
   */
  private async handleAudioSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    // Try to use generateAudio if available (stateless approach)
    if (supportsGenerateAudio(this.ttsPlayer)) {
      return this.handleStatelessAudio(text, options);
    }

    // Fallback: use legacy speak method
    return this.ttsPlayer.speak(text, options);
  }

  /**
   * Stateless 오디오 처리
   */
  private async handleStatelessAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    const audioData = await (this.ttsPlayer as any).generateAudio(
      text,
      options,
    );
    const mimeType = getMimeTypeForPlayer(this.playerType);
    const blob = new Blob([audioData], { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      if (options?.volume) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      // Emit audio start event
      this.eventEmitter?.emit("tts:audio:start", { audioElement: audio });

      // Live2D SDK handles lip sync automatically from audio element

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        this.eventEmitter?.emit("tts:audio:end", {});
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        this.eventEmitter?.emit("tts:audio:end", {});
        reject(new Error("Audio playback failed"));
      };

      audio.play().catch(reject);
    });
  }
}

/**
 * TTS Manager 생성 헬퍼 함수
 */
export function createTTSManager(ttsPlayer: TTSPlayer): TTSManager {
  return new TTSManagerImpl(ttsPlayer);
}
