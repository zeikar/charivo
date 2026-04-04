import { STTTranscriber, STTOptions } from "@charivo/core";
import { MediaRecorderHelper } from "@charivo/stt-core";

export interface RemoteSTTConfig {
  apiEndpoint?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

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

    const response = await fetchWithTimeout(
      this.apiEndpoint,
      {
        method: "POST",
        body: formData,
      },
      `STT request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    );

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

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
