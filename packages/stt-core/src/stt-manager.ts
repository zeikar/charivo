import { STTTranscriber, STTOptions, STTManager } from "@charivo/core";

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
  private eventEmitter?: { emit: (event: string, data: any) => void };

  constructor(sttTranscriber: STTTranscriber) {
    this.sttTranscriber = sttTranscriber;
  }

  /**
   * Set event emitter for STT events
   */
  setEventEmitter(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void {
    console.log("🔗 STT Manager: Event emitter connected");
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start audio recording (delegates to transcriber)
   */
  async start(options?: STTOptions): Promise<void> {
    console.log("🎤 STT Manager: Starting recording", options);
    this.eventEmitter?.emit("stt:start", { options });

    try {
      await this.sttTranscriber.startRecording(options);
      console.log("✅ STT Manager: Recording started");
    } catch (error) {
      console.error("❌ STT Manager: Recording failed", error);
      this.eventEmitter?.emit("stt:error", { error: error as Error });
      throw error;
    }
  }

  /**
   * Stop audio recording and get transcription (delegates to transcriber)
   */
  async stop(): Promise<string> {
    console.log("🛑 STT Manager: Stopping recording");

    try {
      const transcription = await this.sttTranscriber.stopRecording();
      console.log("✅ STT Manager: Transcription completed", transcription);
      this.eventEmitter?.emit("stt:stop", { transcription });
      return transcription;
    } catch (error) {
      console.error("❌ STT Manager: Transcription failed", error);
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
