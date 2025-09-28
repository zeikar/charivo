import OpenAI from "openai";
import { ServerTTSAdapter, TTSOptions } from "@charivo/core";

export interface OpenAITTSConfig {
  apiKey: string;
  defaultVoice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  defaultModel?: "tts-1" | "tts-1-hd";
}

export class OpenAITTSAdapter implements ServerTTSAdapter {
  private openai: OpenAI;
  private defaultVoice: string;

  constructor(config: OpenAITTSConfig) {
    if (typeof window !== "undefined") {
      throw new Error("OpenAI adapter is for server-side use only");
    }

    this.openai = new OpenAI({ apiKey: config.apiKey });
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

export function createOpenAITTSAdapter(
  config: OpenAITTSConfig,
): OpenAITTSAdapter {
  return new OpenAITTSAdapter(config);
}
