import { type STTTranscriber, STTOptions } from "@charivo/core";
import { MediaRecorderHelper } from "../media-recorder-helper";
import {
  createGeminiSTTProvider,
  GeminiSTTConfig,
  GeminiSTTProvider,
} from "./provider";

export {
  createGeminiSTTProvider,
  GeminiSTTProvider,
  type GeminiSTTConfig,
} from "./provider";

// Reuse GeminiSTTConfig directly (no extensions needed)
export type GeminiSTTTranscriberConfig = GeminiSTTConfig;

/**
 * Gemini STT Transcriber - STT Transcriber using Gemini
 *
 * For local development and testing environments. Not recommended for production due to security concerns.
 * API key is exposed on the client side, so should only be used in server environments or for testing purposes.
 *
 * Handles recording internally using MediaRecorderHelper
 */
class GeminiSTTTranscriber implements STTTranscriber {
  private provider: GeminiSTTProvider;
  private recorder: MediaRecorderHelper;
  private recordingOptions?: STTOptions;

  constructor(config: GeminiSTTTranscriberConfig) {
    // Intentional dev/test escape hatch: this direct browser transcriber
    // exposes credentials. For production, see docs/guide/choosing-packages.md#remote.
    this.provider = createGeminiSTTProvider({
      ...config,
      dangerouslyAllowBrowser: true,
    });
    this.recorder = new MediaRecorderHelper();
  }

  /**
   * Start recording audio from microphone
   */
  async startRecording(options?: STTOptions): Promise<void> {
    this.recordingOptions = options;
    await this.recorder.start();
  }

  /**
   * Stop recording and transcribe audio to text
   */
  async stopRecording(): Promise<string> {
    const audioBlob = await this.recorder.stop();
    const transcription = await this.provider.transcribe(
      audioBlob,
      this.recordingOptions,
    );
    this.recordingOptions = undefined;
    return transcription;
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recorder.isRecording();
  }
}

export function createGeminiSTTTranscriber(
  config: GeminiSTTTranscriberConfig,
): STTTranscriber {
  return new GeminiSTTTranscriber(config);
}
