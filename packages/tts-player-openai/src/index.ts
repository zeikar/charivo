import { TTSPlayer, TTSOptions } from "@charivo/core";
import {
  createOpenAITTSProvider,
  OpenAITTSConfig,
  OpenAITTSProvider,
} from "@charivo/tts-provider-openai";

// OpenAITTSConfig를 직접 사용 (확장할 내용이 없으므로)
export type OpenAITTSPlayerConfig = OpenAITTSConfig;

/**
 * OpenAI TTS Player - OpenAI provider를 래핑해서 직접 재생까지 해주는 플레이어
 *
 * 로컬 개발이나 테스트 환경에서 사용. 프로덕션에서는 보안상 권장하지 않음.
 * API 키가 클라이언트에 노출되므로 서버 환경에서만 사용하거나 테스트용으로만 사용해야 함.
 */
export class OpenAITTSPlayer implements TTSPlayer {
  private provider: OpenAITTSProvider;
  private currentAudio: HTMLAudioElement | null = null;

  constructor(config: OpenAITTSPlayerConfig) {
    // 브라우저에서 사용하기 위해 dangerouslyAllowBrowser를 자동으로 true로 설정
    this.provider = createOpenAITTSProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    await this.stop();

    // Provider로부터 오디오 데이터 생성
    const audioBuffer = await this.provider.generateSpeech(text, options);

    // 브라우저에서 재생
    const blob = new Blob([audioBuffer], { type: "audio/mp3" });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      if (options?.volume) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        reject(new Error("Audio playback failed"));
      };

      audio.play().catch(reject);
    });
  }

  async stop(): Promise<void> {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
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
