import { TTSAdapter, TTSOptions } from "@charivo/core";

/**
 * Configuration options for Remote TTS Adapter
 *
 * This is a CLIENT-SIDE adapter that calls your server API endpoint.
 * It does NOT directly call external TTS APIs to keep API keys secure on the server.
 *
 * You need to implement a server endpoint that:
 * 1. Receives: { text, voice, model, speed, format }
 * 2. Calls your chosen TTS API on server-side with your API key
 * 3. Returns: audio data (ArrayBuffer/Blob)
 */
export interface RemoteTTSConfig {
  /** Server API endpoint that handles TTS requests (default: "/api/tts") */
  apiEndpoint?: string;
  /** Default voice to use (depends on your server implementation) */
  defaultVoice?: string;
  /** Default model to use (depends on your server implementation) */
  defaultModel?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Additional request headers */
  headers?: Record<string, string>;
}

/**
 * Remote TTS Adapter - Client-side HTTP adapter for secure TTS integration
 *
 * 🔐 SECURITY NOTE: This adapter is designed for CLIENT-SIDE use and calls your
 * server API endpoint instead of external TTS APIs directly. This keeps your API keys
 * secure on the server side.
 *
 * 🏗️ ARCHITECTURE:
 * Browser/Client → RemoteTTSAdapter → Your Server API → External TTS API (OpenAI, etc.)
 *
 * 📋 REQUIREMENTS:
 * You must implement a server endpoint (default: /api/tts) that:
 * 1. Accepts POST requests with: { text, voice, model, speed, format }
 * 2. Calls your chosen TTS API using your server-side API key
 * 3. Returns audio data as ArrayBuffer/Blob
 *
 * 💡 USAGE:
 * ```typescript
 * import { createRemoteTTSAdapter } from "@charivo/adapter-tts-remote";
 *
 * // For OpenAI TTS backend
 * const ttsAdapter = createRemoteTTSAdapter({
 *   apiEndpoint: "/api/tts",
 *   defaultVoice: "alloy",
 *   defaultModel: "tts-1-hd"
 * });
 *
 * // For other TTS backends
 * const ttsAdapter = createRemoteTTSAdapter({
 *   apiEndpoint: "/api/elevenlabs-tts",
 *   defaultVoice: "some-voice-id"
 * });
 * ```
 *
 * @implements {TTSAdapter}
 */
export class RemoteTTSAdapter implements TTSAdapter {
  private config: Required<RemoteTTSConfig>;
  private currentAudio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;

  constructor(config: RemoteTTSConfig = {}) {
    this.config = {
      apiEndpoint: "/api/tts",
      defaultVoice: "alloy",
      defaultModel: "tts-1",
      timeout: 30000,
      headers: {},
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
      // This calls YOUR server endpoint, not OpenAI directly
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
      this.config.defaultVoice = voiceId;
    } else {
      console.warn(
        `Invalid voice: ${voiceId}. Using default voice: ${this.config.defaultVoice}`,
      );
    }
  }

  async getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
    // Generic remote adapter - voices depend on server implementation
    // For OpenAI TTS backend, these would be the available voices
    const commonVoices = [
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

    return commonVoices as SpeechSynthesisVoice[];
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
  }

  // Helper methods
  private getVoiceFromOptions(options?: TTSOptions): string {
    if (options?.voice) {
      return options.voice;
    }
    return this.config.defaultVoice;
  }

  private isValidVoice(voice: string): boolean {
    // Since this is a generic remote adapter, we accept any voice string
    // Validation should be done on the server side
    return typeof voice === "string" && voice.length > 0;
  }

  // Additional methods for configuration
  setModel(model: string): void {
    this.config.defaultModel = model;
  }

  getModel(): string {
    return this.config.defaultModel;
  }

  setApiEndpoint(endpoint: string): void {
    this.config.apiEndpoint = endpoint;
  }

  getApiEndpoint(): string {
    return this.config.apiEndpoint;
  }

  /**
   * Get information about available TTS providers from server
   */
  async getProviderInfo(): Promise<{
    currentProvider: string;
    availableProviders: string[];
    providerInfo: Record<string, any>;
  }> {
    try {
      const response = await fetch(this.config.apiEndpoint, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get provider info: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(
        `Failed to get provider info: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Test TTS generation with a sample text
   */
  async testTTS(text: string = "Hello, this is a test."): Promise<boolean> {
    try {
      await this.speak(text);
      return true;
    } catch (error) {
      console.warn("TTS test failed:", error);
      return false;
    }
  }
}

/**
 * Factory function to create Remote TTS Adapter
 *
 * 📖 EXAMPLE SERVER IMPLEMENTATIONS:
 *
 * OpenAI TTS Backend:
 * ```typescript
 * // /api/tts/route.ts (Next.js example)
 * import OpenAI from 'openai';
 *
 * const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
 *
 * export async function POST(request) {
 *   const { text, voice, model, speed } = await request.json();
 *
 *   const response = await openai.audio.speech.create({
 *     model, voice, input: text, speed,
 *     response_format: "mp3"
 *   });
 *
 *   const audioBuffer = await response.arrayBuffer();
 *   return new Response(audioBuffer, {
 *     headers: { "Content-Type": "audio/mpeg" }
 *   });
 * }
 * ```
 *
 * ElevenLabs Backend:
 * ```typescript
 * export async function POST(request) {
 *   const { text, voice } = await request.json();
 *   // Call ElevenLabs API...
 * }
 * ```
 *
 * @param config - Configuration options
 * @returns RemoteTTSAdapter instance
 */
export function createRemoteTTSAdapter(
  config?: RemoteTTSConfig,
): RemoteTTSAdapter {
  return new RemoteTTSAdapter(config);
}
