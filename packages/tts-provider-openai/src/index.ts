import OpenAI from "openai";
import { TTSProvider, TTSOptions } from "@charivo/core";

export interface OpenAITTSConfig {
  apiKey: string;
  defaultVoice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  defaultModel?: "tts-1" | "tts-1-hd";
  /**
   * Allow usage in browser (dangerous - exposes API key)
   * Only use for testing/development
   */
  dangerouslyAllowBrowser?: boolean;
}

export class OpenAITTSProvider implements TTSProvider {
  private openai: OpenAI;
  private defaultVoice: string;

  constructor(config: OpenAITTSConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new Error(
        "OpenAI provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.openai = new OpenAI({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    });
    this.defaultVoice = config.defaultVoice || "alloy";
  }

  setVoice(voice: string): void {
    this.defaultVoice = voice;
  }

  async generateSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<ArrayBuffer> {
    const response = await this.openai.audio.speech.create({
      model: "tts-1-hd",
      voice: (options?.voice || this.defaultVoice) as any,
      input: text,
      speed: options?.rate || 1.0,
    });

    return await response.arrayBuffer();
  }
}

export function createOpenAITTSProvider(
  config: OpenAITTSConfig,
): OpenAITTSProvider {
  return new OpenAITTSProvider(config);
}
