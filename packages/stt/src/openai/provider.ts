import OpenAI from "openai";
import { STTProvider, STTOptions } from "@charivo/core";

const REQUEST_TIMEOUT_MS = 30_000;

export interface OpenAISTTConfig {
  apiKey: string;
  defaultModel?: "whisper-1";
  defaultLanguage?: string;
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
    const audioBlob =
      audio instanceof Blob ? audio : new Blob([audio], { type: "audio/wav" });

    const audioFile = new File([audioBlob], "audio.wav", {
      type: "audio/wav",
    });

    const response = await withTimeout(
      this.openai.audio.transcriptions.create({
        file: audioFile,
        model: this.defaultModel,
        language: options?.language || this.defaultLanguage,
      }),
      `OpenAI STT request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    );

    return response.text;
  }
}

export function createOpenAISTTProvider(
  config: OpenAISTTConfig,
): OpenAISTTProvider {
  return new OpenAISTTProvider(config);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(timeoutMessage)),
      REQUEST_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
