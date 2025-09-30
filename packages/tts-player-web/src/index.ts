import { TTSPlayer, TTSOptions } from "@charivo/core";

/**
 * Web TTS Player - Web Speech API를 사용하는 Stateless TTS Player
 *
 * 브라우저 내장 TTS 기능을 사용
 * Stateless 설계: 립싱크 시뮬레이션은 TTS Manager에서 담당
 */
export class WebTTSPlayer implements TTSPlayer {
  private synthesis: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private defaultVoice?: SpeechSynthesisVoice;

  constructor() {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      throw new Error("Web Speech API is not supported in this environment");
    }

    this.synthesis = window.speechSynthesis;
    this.loadVoices();
  }

  private loadVoices(): void {
    const voices = this.synthesis.getVoices();
    if (voices.length > 0) {
      this.voices = voices;
    } else {
      this.synthesis.addEventListener("voiceschanged", () => {
        this.voices = this.synthesis.getVoices();
      });
    }
  }

  /**
   * Simple speak 메서드 (TTS Manager에서 립싱크 처리)
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.synthesis.speaking) {
        this.synthesis.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(text);

      if (options) {
        if (options.rate)
          utterance.rate = Math.max(0.1, Math.min(10, options.rate));
        if (options.pitch)
          utterance.pitch = Math.max(0, Math.min(2, options.pitch));
        if (options.volume)
          utterance.volume = Math.max(0, Math.min(1, options.volume));
        if (options.voice && this.defaultVoice) {
          utterance.voice = this.defaultVoice;
        }
      }

      utterance.onend = () => resolve();
      utterance.onerror = (event) =>
        reject(new Error(`TTS Error: ${event.error}`));

      this.synthesis.speak(utterance);
    });
  }

  async stop(): Promise<void> {
    if (this.synthesis.speaking) {
      this.synthesis.cancel();
    }
  }

  setVoice(voiceId: string): void {
    this.defaultVoice =
      this.voices.find((v) => v.name === voiceId || v.voiceURI === voiceId) ||
      this.voices[0];
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis;
  }
}

export function createWebTTSPlayer(): WebTTSPlayer {
  return new WebTTSPlayer();
}
