/**
 * Real-time lip sync utility for TTS audio integration.
 */
export class RealTimeLipSync {
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private mediaElementSource?: MediaElementAudioSourceNode;
  private dataArray?: Uint8Array;
  private isActive = false;
  private animationFrameId?: number;
  private onRmsUpdate?: (rms: number) => void;

  public connectToAudio(
    audioElement: HTMLAudioElement,
    onRmsUpdate: (rms: number) => void,
  ): void {
    this.cleanup();
    this.onRmsUpdate = onRmsUpdate;

    try {
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      this.mediaElementSource =
        this.audioContext.createMediaElementSource(audioElement);
      this.mediaElementSource.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      this.dataArray = new Uint8Array(
        this.analyser.frequencyBinCount,
      ) as Uint8Array;
      this.isActive = true;
      this.startAnalysis();

      // Resume audio context if suspended (required on some browsers)
      if (this.audioContext.state === "suspended") {
        audioElement.addEventListener(
          "play",
          () => {
            this.audioContext?.resume();
          },
          { once: true },
        );
      }
    } catch (error) {
      console.error("RealTimeLipSync: Failed to set up audio analysis:", error);
    }
  }

  public stop(): void {
    this.isActive = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
    this.onRmsUpdate?.(0); // Reset mouth to closed position
  }

  public cleanup(): void {
    this.stop();

    if (this.mediaElementSource) {
      this.mediaElementSource.disconnect();
      this.mediaElementSource = undefined;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = undefined;
    }

    // Note: Don't close audioContext as it may be used by other components
    this.audioContext = undefined;
    this.dataArray = undefined;
    this.onRmsUpdate = undefined;
  }

  private startAnalysis(): void {
    if (!this.isActive || !this.analyser || !this.dataArray) {
      return;
    }

    this.analyser.getByteFrequencyData(
      this.dataArray as Uint8Array<ArrayBuffer>,
    );

    // Calculate RMS from frequency data (focus on speech frequencies)
    let sum = 0;
    const speechBandStart = Math.floor(this.dataArray.length * 0.1); // ~1kHz
    const speechBandEnd = Math.floor(this.dataArray.length * 0.6); // ~6kHz

    for (let i = speechBandStart; i < speechBandEnd; i++) {
      const normalized = this.dataArray[i] / 255;
      sum += normalized * normalized;
    }

    const rms = Math.sqrt(sum / (speechBandEnd - speechBandStart));
    const smoothedRms = Math.min(rms * 2, 1.0); // Amplify and clamp

    this.onRmsUpdate?.(smoothedRms);

    this.animationFrameId = requestAnimationFrame(() => this.startAnalysis());
  }
}
