import {
  CharivoEventEmitter,
  STTTranscriber,
  STTOptions,
  STTManager,
} from "@charivo/core";

/**
 * STT Manager - Manages STT session state
 *
 * Simplified design: Delegates to STTTranscriber
 * - STTTranscriber handles recording internally
 * - Manager only handles event emission
 * - Thin wrapper for consistent API
 */
export class STTManagerImpl implements STTManager {
  private sttTranscriber: STTTranscriber;
  private eventEmitter?: CharivoEventEmitter;

  constructor(sttTranscriber: STTTranscriber) {
    this.sttTranscriber = sttTranscriber;
  }

  /**
   * Set event emitter for STT events
   */
  setEventEmitter(eventEmitter: CharivoEventEmitter): void {
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start audio recording (delegates to transcriber)
   */
  async start(options?: STTOptions): Promise<void> {
    this.eventEmitter?.emit("stt:start", { options });

    try {
      await this.sttTranscriber.startRecording(options);
    } catch (error) {
      this.eventEmitter?.emit("stt:error", { error: error as Error });
      throw error;
    }
  }

  /**
   * Stop audio recording and get transcription (delegates to transcriber)
   */
  async stop(): Promise<string> {
    try {
      const transcription = await this.sttTranscriber.stopRecording();
      this.eventEmitter?.emit("stt:stop", { transcription });
      return transcription;
    } catch (error) {
      this.eventEmitter?.emit("stt:error", { error: error as Error });
      throw error;
    }
  }

  /**
   * Check if currently recording (delegates to transcriber)
   */
  isRecording(): boolean {
    return this.sttTranscriber.isRecording();
  }
}

/**
 * Helper function to create STT Manager
 */
export function createSTTManager(sttTranscriber: STTTranscriber): STTManager {
  return new STTManagerImpl(sttTranscriber);
}
