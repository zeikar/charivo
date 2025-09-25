import { TTSAdapter, TTSOptions } from "@charivo/core";

export class WebTTSAdapter implements TTSAdapter {
  private synthesis: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = new Array<SpeechSynthesisVoice>();

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
      // Some browsers load voices asynchronously
      this.synthesis.addEventListener('voiceschanged', () => {
        this.voices = this.synthesis.getVoices();
      });
    }
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      // Stop any current speech
      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);

      // Apply options
      if (options) {
        if (options.rate !== undefined) {
          utterance.rate = Math.max(0.1, Math.min(10, options.rate));
        }
        if (options.pitch !== undefined) {
          utterance.pitch = Math.max(0, Math.min(2, options.pitch));
        }
        if (options.volume !== undefined) {
          utterance.volume = Math.max(0, Math.min(1, options.volume));
        }
        if (options.voice) {
          const voice = this.voices.find(v => v.name === options.voice || v.voiceURI === options.voice);
          if (voice) {
            utterance.voice = voice;
          }
        }
      }

      // Set up event handlers
      utterance.onend = () => {
        resolve();
      };

      utterance.onerror = (event) => {
        reject(new Error(`TTS Error: ${event.error}`));
      };

      // Start speaking
      this.synthesis.speak(utterance);
    });
  }

  async stop(): Promise<void> {
    if (this.synthesis.speaking) {
      this.synthesis.cancel();
    }
  }

  async pause(): Promise<void> {
    if (this.synthesis.speaking && !this.synthesis.paused) {
      this.synthesis.pause();
    }
  }

  async resume(): Promise<void> {
    if (this.synthesis.paused) {
      this.synthesis.resume();
    }
  }

  setVoice(voiceId: string): void {
    const voice = this.voices.find(v => v.name === voiceId || v.voiceURI === voiceId);
    if (!voice) {
      console.warn(`Voice "${voiceId}" not found`);
    }
    // Voice will be set per utterance in speak() method
  }

  async getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
    // Ensure voices are loaded
    if (this.voices.length === 0) {
      return new Promise((resolve) => {
        const checkVoices = () => {
          const voices = this.synthesis.getVoices();
          if (voices.length > 0) {
            this.voices = voices;
            resolve(voices);
          } else {
            setTimeout(checkVoices, 100);
          }
        };
        checkVoices();
      });
    }
    return this.voices;
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis;
  }

  // Helper methods for voice selection
  getVoicesByLanguage(language: string): SpeechSynthesisVoice[] {
    return this.voices.filter(voice => voice.lang.startsWith(language));
  }

  getDefaultVoice(language?: string): SpeechSynthesisVoice | undefined {
    if (language) {
      const languageVoices = this.getVoicesByLanguage(language);
      return languageVoices.find(voice => voice.default) || languageVoices[0];
    }
    return this.voices.find(voice => voice.default) || this.voices[0];
  }
}

export function createWebTTSAdapter(): WebTTSAdapter {
  return new WebTTSAdapter();
}