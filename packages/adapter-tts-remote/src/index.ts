import { ClientTTSAdapter, TTSOptions } from "@charivo/core";

export interface RemoteTTSConfig {
  apiEndpoint?: string;
  defaultVoice?: string;
}

export class RemoteTTSAdapter implements ClientTTSAdapter {
  private apiEndpoint: string;
  private defaultVoice: string;
  private currentAudio: HTMLAudioElement | null = null;

  constructor(config: RemoteTTSConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/tts";
    this.defaultVoice = config.defaultVoice || "alloy";
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    await this.stop();

    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: options?.voice || this.defaultVoice,
        speed: options?.rate || 1.0,
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS API failed: ${response.statusText}`);
    }

    const audioBuffer = await response.arrayBuffer();
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
    this.defaultVoice = voice;
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
  }
}

export function createRemoteTTSAdapter(
  config?: RemoteTTSConfig,
): RemoteTTSAdapter {
  return new RemoteTTSAdapter(config);
}
