import { TTSPlayer, TTSOptions } from "@charivo/core";
import {
  createOpenAITTSProvider,
  OpenAITTSConfig,
  OpenAITTSProvider,
} from "@charivo/tts-provider-openai";

// OpenAITTSConfig를 직접 사용 (확장할 내용이 없으므로)
export type OpenAITTSPlayerConfig = OpenAITTSConfig;

/**
 * OpenAI TTS Player - OpenAI provider를 래핑한 Stateless TTS Player
 *
 * 로컬 개발이나 테스트 환경에서 사용. 프로덕션에서는 보안상 권장하지 않음.
 * API 키가 클라이언트에 노출되므로 서버 환경에서만 사용하거나 테스트용으로만 사용해야 함.
 *
 * Stateless 설계: 오디오 재생과 립싱크는 TTS Manager에서 담당
 */
export class OpenAITTSPlayer implements TTSPlayer {
  private provider: OpenAITTSProvider;

  constructor(config: OpenAITTSPlayerConfig) {
    // 브라우저에서 사용하기 위해 dangerouslyAllowBrowser를 자동으로 true로 설정
    this.provider = createOpenAITTSProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
  }

  /**
   * Stateless 오디오 생성 (TTS Manager에서 사용)
   */
  async generateAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<ArrayBuffer> {
    return this.provider.generateSpeech(text, options);
  }

  /**
   * Legacy speak 메서드 (호환성을 위해 유지)
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // 간단한 재생만 수행 (립싱크 없음)
    const audioBuffer = await this.generateAudio(text, options);
    const blob = new Blob([audioBuffer], { type: "audio/mp3" });
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
    this.provider.setVoice(voice);
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
  }
}

export function createOpenAITTSPlayer(
  config: OpenAITTSPlayerConfig,
): OpenAITTSPlayer {
  return new OpenAITTSPlayer(config);
}
