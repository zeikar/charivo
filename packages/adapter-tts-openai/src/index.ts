import OpenAI from "openai";
import { TTSAdapter, TTSOptions } from "@charivo/core";

/**
 * Configuration options for OpenAI TTS Adapter (Server-side)
 *
 * ⚠️ SERVER-SIDE ONLY: This adapter directly calls OpenAI TTS API and should
 * only be used in Node.js server environments where API keys can be kept secure.
 *
 * For client-side usage, use @charivo/adapter-tts-remote instead.
 */
export interface OpenAITTSConfig {
  /** OpenAI API key (required) */
  apiKey: string;
  /** OpenAI API base URL (default: "https://api.openai.com/v1") */
  baseURL?: string;
  /** Default OpenAI voice */
  defaultVoice?: OpenAIVoice;
  /** Default OpenAI TTS model */
  defaultModel?: "tts-1" | "tts-1-hd";
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Allow usage in browser (dangerous - exposes API key) */
  dangerouslyAllowBrowser?: boolean;
}

export type OpenAIVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "shimmer";

/**
 * OpenAI TTS Adapter - Server-side adapter for direct OpenAI TTS integration
 *
 * 🔐 SECURITY WARNING: This adapter is designed for SERVER-SIDE use only as it
 * directly calls OpenAI API with your API key. Using this in client-side code
 * will expose your API key to users.
 *
 * 🏗️ ARCHITECTURE:
 * Node.js Server → OpenAITTSAdapter → OpenAI TTS API
 *
 * 📋 USE CASES:
 * - Server-side pre-generation of speech
 * - Node.js applications
 * - Server-side rendering with TTS
 * - API endpoints that serve audio
 *
 * 💡 CLIENT-SIDE ALTERNATIVE:
 * For browser/client usage, use @charivo/adapter-tts-remote which calls your server API.
 *
 * ⚠️ BROWSER USAGE:
 * If you absolutely must use this in browser (not recommended), set
 * `dangerouslyAllowBrowser: true` in config. This will expose your API key.
 *
 * @implements {TTSAdapter}
 */
export class OpenAITTSAdapter implements TTSAdapter {
  private openai: OpenAI;
  private config: Required<Omit<OpenAITTSConfig, "dangerouslyAllowBrowser">> & {
    dangerouslyAllowBrowser?: boolean;
  };

  constructor(config: OpenAITTSConfig) {
    // Security check for browser environment
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new Error(
        "⚠️ SECURITY WARNING: OpenAITTSAdapter should not be used in browser environments as it exposes your API key. " +
          "Use @charivo/adapter-tts-remote instead for client-side usage. " +
          "If you absolutely must use this in browser, set dangerouslyAllowBrowser: true",
      );
    }

    if (!config.apiKey) {
      throw new Error("OpenAI API key is required");
    }

    this.config = {
      baseURL: "https://api.openai.com/v1",
      defaultVoice: "alloy",
      defaultModel: "tts-1",
      timeout: 30000,
      ...config,
    };

    this.openai = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    });
  }

  async speak(_text: string, _options?: TTSOptions): Promise<void> {
    // Server-side adapter doesn't play audio, it generates it
    // This method could be used to save to file or stream
    throw new Error(
      "speak() method is not implemented for server-side adapter. " +
        "Use generateSpeech() to get audio data instead.",
    );
  }

  async stop(): Promise<void> {
    // No-op for server-side adapter
  }

  async pause(): Promise<void> {
    // No-op for server-side adapter
  }

  async resume(): Promise<void> {
    // No-op for server-side adapter
  }

  setVoice(voiceId: string): void {
    if (this.isValidVoice(voiceId)) {
      this.config.defaultVoice = voiceId as OpenAIVoice;
    } else {
      console.warn(
        `Invalid OpenAI voice: ${voiceId}. Valid voices: ${this.getValidVoices().join(", ")}`,
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
    return !!this.config.apiKey;
  }

  // OpenAI-specific methods for server-side usage

  /**
   * Generate speech audio data using OpenAI TTS
   *
   * @param text - Text to convert to speech
   * @param options - TTS options
   * @returns Promise<ArrayBuffer> - Audio data
   */
  async generateSpeech(
    text: string,
    options?: TTSOptions & {
      format?: "mp3" | "opus" | "aac" | "flac";
    },
  ): Promise<ArrayBuffer> {
    try {
      const voice = this.getVoiceFromOptions(options);
      const model = this.config.defaultModel;
      const speed = Math.max(0.25, Math.min(4.0, options?.rate || 1.0));
      const format = options?.format || "mp3";

      const response = await this.openai.audio.speech.create({
        model,
        voice,
        input: text,
        response_format: format,
        speed,
      });

      return await response.arrayBuffer();
    } catch (error) {
      throw new Error(
        `OpenAI TTS Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Helper methods
  private getVoiceFromOptions(options?: TTSOptions): OpenAIVoice {
    if (options?.voice && this.isValidVoice(options.voice)) {
      return options.voice as OpenAIVoice;
    }
    return this.config.defaultVoice;
  }

  private isValidVoice(voice: string): boolean {
    return this.getValidVoices().includes(voice as OpenAIVoice);
  }

  private getValidVoices(): OpenAIVoice[] {
    return ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
  }

  // Configuration methods
  setModel(model: "tts-1" | "tts-1-hd"): void {
    this.config.defaultModel = model;
  }

  getModel(): "tts-1" | "tts-1-hd" {
    return this.config.defaultModel;
  }

  getApiKey(): string {
    return this.config.apiKey;
  }
}

/**
 * Factory function to create OpenAI TTS Adapter (Server-side)
 *
 * 📖 USAGE EXAMPLES:
 *
 * Basic usage:
 * ```typescript
 * import { createOpenAITTSAdapter } from "@charivo/adapter-tts-openai";
 *
 * const adapter = createOpenAITTSAdapter({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   defaultVoice: "alloy",
 *   defaultModel: "tts-1-hd"
 * });
 *
 * // Generate audio data
 * const audioBuffer = await adapter.generateSpeech("Hello world!");
 *
 * // Save to file (Node.js only)
 * await adapter.generateSpeechToFile("Hello world!", "./output.mp3");
 * ```
 *
 * API endpoint usage:
 * ```typescript
 * // Express.js example
 * app.post('/api/tts', async (req, res) => {
 *   const { text } = req.body;
 *   const audioBuffer = await adapter.generateSpeech(text);
 *
 *   res.set('Content-Type', 'audio/mpeg');
 *   res.send(Buffer.from(audioBuffer));
 * });
 * ```
 *
 * @param config - Configuration options including API key
 * @returns OpenAITTSAdapter instance
 */
export function createOpenAITTSAdapter(
  config: OpenAITTSConfig,
): OpenAITTSAdapter {
  return new OpenAITTSAdapter(config);
}
