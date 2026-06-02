import {
  CharivoEventEmitter,
  TTSPlayer,
  TTSPlaybackMode,
  TTSOptions,
  TTSManager,
  toCharivoError,
} from "@charivo/core";
import { WebSpeechLipSyncSimulator } from "./web-speech-lipsync-simulator";
import {
  getTTSAudioMimeType,
  getTTSPlaybackMode,
  supportsGenerateAudio,
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
  private eventEmitter?: CharivoEventEmitter;
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private playbackMode: TTSPlaybackMode;
  private isAudioSessionActive = false;

  // Web Speech 립싱크 시뮬레이션만 필요
  private webSimulator: WebSpeechLipSyncSimulator;

  constructor(ttsPlayer: TTSPlayer) {
    this.ttsPlayer = ttsPlayer;
    this.playbackMode = getTTSPlaybackMode(ttsPlayer);

    // Initialize Web Speech simulator
    this.webSimulator = new WebSpeechLipSyncSimulator();
  }

  /**
   * 이벤트 발신자 설정
   */
  setEventEmitter(eventEmitter: CharivoEventEmitter): void {
    this.eventEmitter = eventEmitter;

    // Connect event emitter to Web Speech simulator
    this.webSimulator = new WebSpeechLipSyncSimulator(eventEmitter);
  }

  /**
   * 텍스트 음성 변환 및 재생
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    try {
      await this.stop().catch((error) => {
        throw toCharivoError("provider", error, "Failed to stop active TTS");
      });

      if (this.playbackMode === "web-speech") {
        return await this.handleWebSpeech(text, options);
      } else {
        return await this.handleAudioSpeech(text, options);
      }
    } catch (error) {
      throw toCharivoError("provider", error, "Failed to speak text");
    }
  }

  /**
   * 현재 재생 중인 음성 중지
   */
  async stop(): Promise<void> {
    this.webSimulator.stopSimulation();

    try {
      await this.ttsPlayer.stop();
    } catch (error) {
      console.warn("⚠️ TTS Manager: Failed to stop player cleanly", error);
      throw toCharivoError("provider", error, "Failed to stop TTS");
    } finally {
      if (this.currentAudio) {
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.pause();
        this.currentAudio = null;
      }

      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = null;
      }

      this.endAudioSession();
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
    this.startAudioSession(dummyAudio);

    // Start simulated lip sync using dedicated component
    this.webSimulator.startSimulation(text, options?.rate || 1);

    // Delegate to player and wait for completion
    try {
      await this.ttsPlayer.speak(text, options);
    } finally {
      this.webSimulator.stopSimulation();
      this.endAudioSession();
    }
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
    this.startAudioSession();
    try {
      await this.ttsPlayer.speak(text, options);
    } finally {
      this.endAudioSession();
    }
  }

  /**
   * Stateless 오디오 처리
   */
  private async handleStatelessAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    const audioData = await this.ttsPlayer.generateAudio!(text, options).catch(
      (error) =>
        Promise.reject(
          toCharivoError("provider", error, "Failed to generate TTS audio"),
        ),
    );
    const mimeType = getTTSAudioMimeType(this.ttsPlayer);
    const blob = new Blob([audioData], { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      this.currentAudioUrl = audioUrl;

      if (options?.volume !== undefined) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      // Emit audio start event
      this.startAudioSession(audio);

      // Live2D SDK handles lip sync automatically from audio element

      let isFinalized = false;
      const finalize = (next: () => void) => {
        if (isFinalized) return;
        isFinalized = true;

        if (this.currentAudioUrl) {
          URL.revokeObjectURL(this.currentAudioUrl);
          this.currentAudioUrl = null;
        }

        this.currentAudio = null;
        this.endAudioSession();
        next();
      };

      audio.onended = () => {
        finalize(resolve);
      };

      audio.onerror = () => {
        finalize(() => reject(new Error("Audio playback failed")));
      };

      audio.play().catch((error) => {
        finalize(() =>
          reject(
            error instanceof Error ? error : new Error("Audio playback failed"),
          ),
        );
      });
    });
  }

  private startAudioSession(audioElement?: HTMLAudioElement): void {
    if (this.isAudioSessionActive) {
      return;
    }
    this.isAudioSessionActive = true;
    this.eventEmitter?.emit("tts:audio:start", { audioElement });
  }

  private endAudioSession(): void {
    if (!this.isAudioSessionActive) {
      return;
    }
    this.isAudioSessionActive = false;
    this.eventEmitter?.emit("tts:audio:end", {});
  }
}

/**
 * TTS Manager 생성 헬퍼 함수
 */
export function createTTSManager(ttsPlayer: TTSPlayer): TTSManager {
  return new TTSManagerImpl(ttsPlayer);
}
