import { STTTranscriber, STTOptions } from "@charivo/core";

export interface RemoteSTTConfig {
  apiEndpoint?: string;
}

/**
 * Remote STT Transcriber - Uses remote server's STT API for transcription
 *
 * Processes STT on the server and receives transcribed text
 * Stateless design: Only handles audio transcription (recording is handled by STT Manager)
 */
export class RemoteSTTTranscriber implements STTTranscriber {
  private apiEndpoint: string;

  constructor(config: RemoteSTTConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/stt";
  }

  /**
   * Transcribe audio data to text using remote API
   */
  async transcribe(
    audio: Blob | ArrayBuffer,
    options?: STTOptions,
  ): Promise<string> {
    const formData = new FormData();

    // Convert ArrayBuffer to Blob if needed
    const audioBlob =
      audio instanceof Blob ? audio : new Blob([audio], { type: "audio/webm" });

    formData.append("audio", audioBlob, "recording.webm");

    if (options?.language) {
      formData.append("language", options.language);
    }

    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`STT API failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.transcription;
  }
}

export function createRemoteSTTTranscriber(
  config?: RemoteSTTConfig,
): RemoteSTTTranscriber {
  return new RemoteSTTTranscriber(config);
}
