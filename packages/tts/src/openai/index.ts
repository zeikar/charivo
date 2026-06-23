import { TTSPlayer, TTSOptions } from "@charivo/core";
import {
  createOpenAITTSProvider,
  OpenAITTSConfig,
  OpenAITTSProvider,
} from "./provider";

// Use OpenAITTSConfig directly (nothing to extend)
export type OpenAITTSPlayerConfig = OpenAITTSConfig;

/**
 * OpenAI TTS Player - Stateless TTS Player that wraps the OpenAI provider
 *
 * For use in local development or test environments. Not recommended for production for security reasons.
 * The API key is exposed to the client, so use it only in a server environment or for testing purposes.
 *
 * Stateless design: audio playback and lip-sync are handled by the TTS Manager
 */
export class OpenAITTSPlayer implements TTSPlayer {
  readonly playbackMode = "audio" as const;
  readonly audioMimeType = "audio/wav";
  private provider: OpenAITTSProvider;

  constructor(config: OpenAITTSPlayerConfig) {
    // Intentional dev/test escape hatch: this direct browser player exposes
    // credentials. For production, see docs/guide/choosing-packages.md#remote.
    this.provider = createOpenAITTSProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
  }

  /**
   * Stateless audio generation (used by the TTS Manager)
   */
  async generateAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<ArrayBuffer> {
    return this.provider.generateSpeech(text, options);
  }

  /**
   * Legacy speak method (kept for compatibility)
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // Perform simple playback only (no lip-sync)
    const audioBuffer = await this.generateAudio(text, options);
    const blob = new Blob([audioBuffer], { type: "audio/mp3" });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);

      if (options?.volume !== undefined) {
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
    // Stateless, so no special cleanup is needed
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
