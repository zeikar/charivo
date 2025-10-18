/**
 * MediaRecorderHelper - Browser audio recording utility
 *
 * Handles MediaRecorder lifecycle:
 * - Start/stop recording
 * - Audio chunk collection
 * - Stream cleanup
 * - Blob generation
 */
export class MediaRecorderHelper {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recording = false;

  /**
   * Start audio recording from user's microphone
   */
  async start(): Promise<void> {
    if (this.recording) {
      throw new Error("Already recording");
    }

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
  }

  /**
   * Stop audio recording and return the recorded audio as a Blob
   */
  async stop(): Promise<Blob> {
    if (!this.recording || !this.mediaRecorder) {
      throw new Error("Not recording");
    }

    return new Promise((resolve, reject) => {
      this.mediaRecorder!.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });

        // Cleanup
        this.audioChunks = [];
        this.mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
        this.mediaRecorder = null;
        this.recording = false;

        resolve(audioBlob);
      };

      this.mediaRecorder!.onerror = (error) => {
        this.recording = false;
        reject(error);
      };

      this.mediaRecorder!.stop();
    });
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Abort recording immediately without returning data
   */
  abort(): void {
    if (this.mediaRecorder) {
      this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      this.mediaRecorder = null;
      this.audioChunks = [];
      this.recording = false;
    }
  }
}
