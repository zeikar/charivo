import { TTSPlayer, TTSOptions } from "@charivo/core";

export interface RemoteTTSConfig {
  apiEndpoint?: string;
  defaultVoice?: string;
}

/**
 * Remote TTS Player - 원격 서버의 TTS API를 사용하는 Stateless TTS Player
 *
 * 서버에서 TTS를 처리하고 오디오 데이터를 받아옴
 * Stateless 설계: 오디오 재생과 립싱크는 TTS Manager에서 담당
 */
export class RemoteTTSPlayer implements TTSPlayer {
  private apiEndpoint: string;
  private defaultVoice: string;

  constructor(config: RemoteTTSConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/tts";
    this.defaultVoice = config.defaultVoice || "marin";
  }

  /**
   * Stateless 오디오 생성 (TTS Manager에서 사용)
   */
  async generateAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<ArrayBuffer> {
    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: options?.voice || this.defaultVoice,
        speed: options?.rate || 1.0,
        format: "wav",
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS API failed: ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Legacy speak 메서드 (호환성을 위해 유지)
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // 간단한 재생만 수행 (립싱크 없음)
    const audioBuffer = await this.generateAudio(text, options);
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);

      if (options?.volume) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        reject(new Error("Audio playback failed"));
      };

      audio.play().catch(reject);
    });
  }

  async stop(): Promise<void> {
    // Stateless이므로 특별한 정리 작업 없음
  }

  setVoice(voice: string): void {
    this.defaultVoice = voice;
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
  }
}

export function createRemoteTTSPlayer(
  config?: RemoteTTSConfig,
): RemoteTTSPlayer {
  return new RemoteTTSPlayer(config);
}
