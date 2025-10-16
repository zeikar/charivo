import { STTTranscriber, STTOptions, STTManager } from "@charivo/core";

/**
 * STT Manager - Manages STT session state
 *
 * Responsibilities:
 * - Browser recording control using Web Audio API
 * - Audio transcription using STT Transcriber
 * - Event emission (stt:start, stt:stop, stt:error)
 * - Session state management
 */
export class STTManagerImpl implements STTManager {
  private sttTranscriber: STTTranscriber;
  private eventEmitter?: { emit: (event: string, data: any) => void };
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recording = false;

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
   * Start audio recording
   */
  async start(options?: STTOptions): Promise<void> {
    if (this.recording) {
      throw new Error("Already recording");
    }

    console.log("🎤 STT Manager: Starting recording", options);
    this.eventEmitter?.emit("stt:start", { options });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start();
      this.recording = true;
      console.log("✅ STT Manager: Recording started");
    } catch (error) {
      console.error("❌ STT Manager: Recording failed", error);
      this.eventEmitter?.emit("stt:error", { error: error as Error });
      throw error;
    }
  }

  /**
   * Stop audio recording and transcribe to text
   */
  async stop(): Promise<string> {
    if (!this.recording || !this.mediaRecorder) {
      throw new Error("Not recording");
    }

    console.log("🛑 STT Manager: Stopping recording");

    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("MediaRecorder not initialized"));
        return;
      }

      this.mediaRecorder.onstop = async () => {
        try {
          // Combine audio chunks into a single Blob
          const audioBlob = new Blob(this.audioChunks, {
            type: "audio/webm",
          });

          console.log("🔄 STT Manager: Transcribing audio...");

          // Transcribe using transcriber
          const transcription = await this.sttTranscriber.transcribe(audioBlob);

          console.log("✅ STT Manager: Transcription completed", transcription);
          this.eventEmitter?.emit("stt:stop", { transcription });

          // Cleanup
          this.recording = false;
          this.audioChunks = [];
          if (this.mediaRecorder?.stream) {
            this.mediaRecorder.stream
              .getTracks()
              .forEach((track) => track.stop());
          }
          this.mediaRecorder = null;

          resolve(transcription);
        } catch (error) {
          console.error("❌ STT Manager: Transcription failed", error);
          this.eventEmitter?.emit("stt:error", { error: error as Error });
          this.recording = false;
          reject(error);
        }
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recording;
  }
}

/**
 * Helper function to create STT Manager
 */
export function createSTTManager(sttTranscriber: STTTranscriber): STTManager {
  return new STTManagerImpl(sttTranscriber);
}
