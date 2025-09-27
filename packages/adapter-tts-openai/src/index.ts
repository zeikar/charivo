import { TTSAdapter, TTSOptions } from "@charivo/core";

export interface OpenAITTSConfig {
  apiEndpoint?: string;
  defaultVoice?: OpenAIVoice;
  defaultModel?: "tts-1" | "tts-1-hd";
  timeout?: number;
}

export type OpenAIVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "shimmer";

export class OpenAITTSAdapter implements TTSAdapter {
  private config: Required<OpenAITTSConfig>;
  private currentAudio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;

  constructor(config: OpenAITTSConfig = {}) {
    this.config = {
      apiEndpoint: "/api/tts",
      defaultVoice: "alloy",
      defaultModel: "tts-1",
      timeout: 30000,
      ...config,
    };

    // Initialize audio context for better browser compatibility
    if (typeof window !== "undefined") {
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    try {
      // Stop any currently playing audio
      await this.stop();

      const voice = this.getVoiceFromOptions(options);
      const model = this.config.defaultModel;
      const speed = options?.rate || 1.0;

      // Call API endpoint to generate speech
      const response = await fetch(this.config.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          voice,
          model,
          speed,
          format: "mp3",
        }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(
          `TTS API call failed: ${errorData.error || response.statusText}`,
        );
      }

      // Get audio data from response
      const audioBuffer = await response.arrayBuffer();

      // Create audio element and play
      return new Promise((resolve, reject) => {
        const audio = new Audio();
        const blob = new Blob([audioBuffer], { type: "audio/mp3" });
        const audioUrl = URL.createObjectURL(blob);

        audio.src = audioUrl;
        this.currentAudio = audio;

        // Apply volume if specified
        if (options?.volume !== undefined) {
          audio.volume = Math.max(0, Math.min(1, options.volume));
        }

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          resolve();
        };

        audio.onerror = (error) => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          reject(new Error(`Audio playback error: ${error}`));
        };

        // Resume audio context if suspended (required by some browsers)
        if (this.audioContext && this.audioContext.state === "suspended") {
          this.audioContext.resume().then(() => {
            audio.play().catch(reject);
          });
        } else {
          audio.play().catch(reject);
        }
      });
    } catch (error) {
      throw new Error(
        `OpenAI TTS Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async stop(): Promise<void> {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  async pause(): Promise<void> {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
    }
  }

  async resume(): Promise<void> {
    if (this.currentAudio && this.currentAudio.paused) {
      try {
        await this.currentAudio.play();
      } catch (error) {
        throw new Error(`Failed to resume audio: ${error}`);
      }
    }
  }

  setVoice(voiceId: string): void {
    if (this.isValidVoice(voiceId)) {
      this.config.defaultVoice = voiceId as OpenAIVoice;
    } else {
      console.warn(
        `Invalid OpenAI voice: ${voiceId}. Using default voice: ${this.config.defaultVoice}`,
      );
    }
  }

  async getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
    // OpenAI TTS voices as SpeechSynthesisVoice-compatible objects
    const voices = [
      {
        voiceURI: "alloy",
        name: "Alloy",
        lang: "en-US",
        localService: false,
        default: true,
      },
      {
        voiceURI: "echo",
        name: "Echo",
        lang: "en-US",
        localService: false,
        default: false,
      },
      {
        voiceURI: "fable",
        name: "Fable",
        lang: "en-US",
        localService: false,
        default: false,
      },
      {
        voiceURI: "onyx",
        name: "Onyx",
        lang: "en-US",
        localService: false,
        default: false,
      },
      {
        voiceURI: "nova",
        name: "Nova",
        lang: "en-US",
        localService: false,
        default: false,
      },
      {
        voiceURI: "shimmer",
        name: "Shimmer",
        lang: "en-US",
        localService: false,
        default: false,
      },
    ];

    return voices as SpeechSynthesisVoice[];
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
  }

  // Helper methods
  private getVoiceFromOptions(options?: TTSOptions): OpenAIVoice {
    if (options?.voice && this.isValidVoice(options.voice)) {
      return options.voice as OpenAIVoice;
    }
    return this.config.defaultVoice;
  }

  private isValidVoice(voice: string): boolean {
    const validVoices: OpenAIVoice[] = [
      "alloy",
      "echo",
      "fable",
      "onyx",
      "nova",
      "shimmer",
    ];
    return validVoices.includes(voice as OpenAIVoice);
  }

  // Additional methods for OpenAI-specific functionality
  setModel(model: "tts-1" | "tts-1-hd"): void {
    this.config.defaultModel = model;
  }

  getModel(): "tts-1" | "tts-1-hd" {
    return this.config.defaultModel;
  }

  setApiEndpoint(endpoint: string): void {
    this.config.apiEndpoint = endpoint;
  }

  getApiEndpoint(): string {
    return this.config.apiEndpoint;
  }
}

export function createOpenAITTSAdapter(
  config?: OpenAITTSConfig,
): OpenAITTSAdapter {
  return new OpenAITTSAdapter(config);
}
