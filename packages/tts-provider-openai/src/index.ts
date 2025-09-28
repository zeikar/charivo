import OpenAI from "openai";
import { TTSProvider, TTSOptions } from "@charivo/core";

type OpenAITTSModel = "tts-1" | "tts-1-hd" | "gpt-4o-mini-tts";

export interface OpenAITTSConfig {
  apiKey: string;
  defaultVoice?:
    | "alloy"
    | "echo"
    | "fable"
    | "marin"
    | "onyx"
    | "nova"
    | "shimmer";
  defaultModel?: OpenAITTSModel;
  /**
   * Allow usage in browser (dangerous - exposes API key)
   * Only use for testing/development
   */
  dangerouslyAllowBrowser?: boolean;
}

export class OpenAITTSProvider implements TTSProvider {
  private openai: OpenAI;
  private defaultVoice: string;
  private defaultModel: OpenAITTSModel;

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
    this.defaultVoice = config.defaultVoice || "marin";
    this.defaultModel = config.defaultModel || "gpt-4o-mini-tts";
  }

  setVoice(voice: string): void {
    this.defaultVoice = voice;
  }

  setModel(model: OpenAITTSModel): void {
    this.defaultModel = model;
  }

  async generateSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<ArrayBuffer> {
    const response = await this.openai.audio.speech.create({
      model: this.defaultModel,
      voice: options?.voice || this.defaultVoice,
      input: text,
      speed: options?.rate || 1.0,
      format: "wav",
    } as Parameters<typeof this.openai.audio.speech.create>[0]);

    return await response.arrayBuffer();
  }
}

export function createOpenAITTSProvider(
  config: OpenAITTSConfig,
): OpenAITTSProvider {
  return new OpenAITTSProvider(config);
}
