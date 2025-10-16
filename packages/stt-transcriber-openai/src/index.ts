import { STTTranscriber, STTOptions } from "@charivo/core";
import {
  createOpenAISTTProvider,
  OpenAISTTConfig,
  OpenAISTTProvider,
} from "@charivo/stt-provider-openai";

// Reuse OpenAISTTConfig directly (no extensions needed)
export type OpenAISTTTranscriberConfig = OpenAISTTConfig;

/**
 * OpenAI STT Transcriber - STT Transcriber wrapping OpenAI provider
 *
 * For local development and testing environments. Not recommended for production due to security concerns.
 * API key is exposed on the client side, so should only be used in server environments or for testing purposes.
 *
 * Stateless design: Only handles audio transcription (recording is handled by STT Manager)
 */
export class OpenAISTTTranscriber implements STTTranscriber {
  private provider: OpenAISTTProvider;

  constructor(config: OpenAISTTTranscriberConfig) {
    // Automatically set dangerouslyAllowBrowser to true for browser usage
    this.provider = createOpenAISTTProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
  }

  /**
   * Transcribe audio data to text
   */
  async transcribe(
    audio: Blob | ArrayBuffer,
    options?: STTOptions,
  ): Promise<string> {
    return this.provider.transcribe(audio, options);
  }
}

export function createOpenAISTTTranscriber(
  config: OpenAISTTTranscriberConfig,
): OpenAISTTTranscriber {
  return new OpenAISTTTranscriber(config);
}
