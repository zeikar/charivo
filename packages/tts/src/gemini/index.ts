import { type TTSPcmStream, type TTSPlayer, TTSOptions } from "@charivo/core";
import {
  createGeminiTTSProvider,
  GeminiTTSConfig,
  GeminiTTSProvider,
} from "./provider";

export {
  createGeminiTTSProvider,
  GeminiTTSProvider,
  type GeminiTTSConfig,
} from "./provider";

/**
 * The provider's config without `dangerouslyAllowBrowser`, which this player
 * forces on: accepting it would offer a switch the constructor ignores, and a
 * caller passing `false` would read it as keeping credentials out of the
 * browser. A type error says so while they can still act on it.
 */
export type GeminiTTSPlayerConfig = Omit<
  GeminiTTSConfig,
  "dangerouslyAllowBrowser"
> & {
  /**
   * Opt in to `generateAudioStream`. Off by default: the manager streams
   * whenever the method exists, and streaming is not a free upgrade here.
   * This player caps no text, and the streaming endpoint truncates a long one
   * with a non-`STOP` finish reason -- which fails the utterance mid-sentence
   * where the buffered path completes it -- while streamed playback also needs
   * a running `AudioContext`, so `speak()` starts requiring a `prepareAudio()`
   * from a user gesture.
   */
  streaming?: boolean;
};

/**
 * Gemini TTS Player - Stateless TTS Player that wraps the Gemini provider
 *
 * For use in local development or test environments. Not recommended for production for security reasons.
 * The API key is exposed to the client, so use it only in a server environment or for testing purposes.
 *
 * Stateless design: audio playback and lip-sync are handled by the TTS Manager
 */
class GeminiTTSPlayer implements TTSPlayer {
  readonly playbackMode = "audio" as const;
  readonly audioMimeType = "audio/wav";
  /**
   * Present only on a streaming player: the manager selects the streaming
   * path with `typeof player.generateAudioStream === "function"`, so an
   * unflagged player must not carry the method at all.
   */
  generateAudioStream?: (
    text: string,
    options?: TTSOptions,
    signal?: AbortSignal,
  ) => Promise<TTSPcmStream>;
  private provider: GeminiTTSProvider;

  constructor({ streaming, ...config }: GeminiTTSPlayerConfig) {
    // Intentional dev/test escape hatch: this direct browser player exposes
    // credentials. For production, see docs/guide/choosing-packages.md#remote.
    this.provider = createGeminiTTSProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });

    if (streaming) {
      this.generateAudioStream = (text, options, signal) =>
        this.provider.generateSpeechStream(text, options, signal);
    }
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
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
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

      // A blocked autoplay start never fires onended/onerror, so the object
      // URL is revoked here too - otherwise a rejected play() would strand it.
      audio.play().catch((error) => {
        URL.revokeObjectURL(audioUrl);
        reject(error);
      });
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

export function createGeminiTTSPlayer(
  config: GeminiTTSPlayerConfig,
): TTSPlayer {
  return new GeminiTTSPlayer(config);
}
