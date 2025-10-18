import { STTTranscriber, STTOptions } from "@charivo/core";
import { MediaRecorderHelper } from "@charivo/stt-core";

export interface RemoteSTTConfig {
  apiEndpoint?: string;
}

/**
 * Remote STT Transcriber - Uses remote server's STT API for transcription
 *
 * Processes STT on the server and receives transcribed text
 * Handles recording internally using MediaRecorderHelper
 */
export class RemoteSTTTranscriber implements STTTranscriber {
  private apiEndpoint: string;
  private recorder: MediaRecorderHelper;
  private recordingOptions?: STTOptions;

  constructor(config: RemoteSTTConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/stt";
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
   * Stop recording and transcribe audio to text using remote API
   */
  async stopRecording(): Promise<string> {
    const audioBlob = await this.recorder.stop();

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    if (this.recordingOptions?.language) {
      formData.append("language", this.recordingOptions.language);
    }

    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`STT API failed: ${response.statusText}`);
    }

    const data = await response.json();
    this.recordingOptions = undefined;
    return data.transcription;
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recorder.isRecording();
  }
}

export function createRemoteSTTTranscriber(
  config?: RemoteSTTConfig,
): RemoteSTTTranscriber {
  return new RemoteSTTTranscriber(config);
}
