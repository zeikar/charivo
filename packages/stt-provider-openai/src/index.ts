import OpenAI from "openai";
import { STTProvider, STTOptions } from "@charivo/core";

export interface OpenAISTTConfig {
  apiKey: string;
  defaultModel?: "whisper-1";
  defaultLanguage?: string;
  /**
   * Allow usage in browser (dangerous - exposes API key)
   * Only use for testing/development
   */
  dangerouslyAllowBrowser?: boolean;
}

export class OpenAISTTProvider implements STTProvider {
  private openai: OpenAI;
  private defaultModel: "whisper-1";
  private defaultLanguage?: string;

  constructor(config: OpenAISTTConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new Error(
        "OpenAI provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.openai = new OpenAI({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    });
    this.defaultModel = config.defaultModel || "whisper-1";
    this.defaultLanguage = config.defaultLanguage;
  }

  async transcribe(
    audio: Blob | ArrayBuffer,
    options?: STTOptions,
  ): Promise<string> {
    // Convert ArrayBuffer to Blob if needed
    const audioBlob =
      audio instanceof Blob ? audio : new Blob([audio], { type: "audio/wav" });

    // Create File object for OpenAI API
    const audioFile = new File([audioBlob], "audio.wav", {
      type: "audio/wav",
    });

    const response = await this.openai.audio.transcriptions.create({
      file: audioFile,
      model: this.defaultModel,
      language: options?.language || this.defaultLanguage,
    });

    return response.text;
  }
}

export function createOpenAISTTProvider(
  config: OpenAISTTConfig,
): OpenAISTTProvider {
  return new OpenAISTTProvider(config);
}
