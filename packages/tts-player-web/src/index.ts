import { TTSPlayer, TTSOptions } from "@charivo/core";

export class WebTTSPlayer implements TTSPlayer {
  private synthesis: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];

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

  async speak(text: string, options?: TTSOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);

      if (options) {
        if (options.rate)
          utterance.rate = Math.max(0.1, Math.min(10, options.rate));
        if (options.pitch)
          utterance.pitch = Math.max(0, Math.min(2, options.pitch));
        if (options.volume)
          utterance.volume = Math.max(0, Math.min(1, options.volume));
        if (options.voice) {
          const voice = this.voices.find(
            (v) => v.name === options.voice || v.voiceURI === options.voice,
          );
          if (voice) utterance.voice = voice;
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
    const voice = this.voices.find(
      (v) => v.name === voiceId || v.voiceURI === voiceId,
    );
    if (!voice) {
      console.warn(`Voice "${voiceId}" not found`);
    }
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis;
  }
}

export function createWebTTSPlayer(): WebTTSPlayer {
  return new WebTTSPlayer();
}
