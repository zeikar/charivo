/**
 * Shared lip sync audio analysis: the single RMS computation used across the repo.
 */
export const LIPSYNC_FFT_SIZE = 256;
export const LIPSYNC_SMOOTHING_TIME_CONSTANT = 0.8;

/**
 * Compute a mouth-open value from frequency data, focusing on speech frequencies.
 */
export function computeLipSyncRms(frequencyData: Uint8Array): number {
  // 10-60% of the spectrum (~2-14kHz at a 48kHz context)
  const speechBandStart = Math.floor(frequencyData.length * 0.1);
  const speechBandEnd = Math.floor(frequencyData.length * 0.6);

  let sum = 0;
  for (let index = speechBandStart; index < speechBandEnd; index += 1) {
    const normalized = frequencyData[index] / 255;
    sum += normalized * normalized;
  }

  const rms = Math.sqrt(sum / (speechBandEnd - speechBandStart));
  return Math.min(rms * 2, 1); // Amplify and clamp
}

export interface LipSyncAnalyzerOptions {
  onRms: (rms: number) => void;
  onError?: (error: unknown) => void;
}

export interface LipSyncAnalyzer {
  /**
   * Create the AudioContext up front (idempotent).
   */
  prepare(): Promise<void>;
  /**
   * Analyze an audio element while keeping its playback audible.
   */
  attachMediaElement(element: HTMLAudioElement): void;
  /**
   * Analyze a media stream without routing it to the speakers.
   */
  attachMediaStream(stream: MediaStream): void;
  /**
   * Temporarily halt analysis; `resume()` restarts it.
   */
  pause(): void;
  resume(): void;
  /**
   * Halt analysis for the current source. `resume()` no-ops until the next attach.
   */
  stop(): void;
  cleanup(): Promise<void>;
}

class LipSyncAnalyzerImpl implements LipSyncAnalyzer {
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private source?: AudioNode;
  private attachedStream?: MediaStream;
  private dataArray?: Uint8Array<ArrayBuffer>;
  private isActive = false;
  private animationFrameId?: number;

  constructor(private options: LipSyncAnalyzerOptions) {}

  async prepare(): Promise<void> {
    if (this.audioContext) {
      return;
    }

    const audioContextConstructor =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!audioContextConstructor) {
      throw new Error("AudioContext is not supported in this browser");
    }

    this.audioContext = new audioContextConstructor();
  }

  attachMediaElement(element: HTMLAudioElement): void {
    this.stop();
    this.resetNodes();

    try {
      const audioContext = this.ensureAudioContext();
      if (!audioContext) {
        return;
      }

      const analyser = this.createAnalyser(audioContext);
      const source = audioContext.createMediaElementSource(element);
      source.connect(analyser);
      analyser.connect(audioContext.destination); // Keep playback audible

      this.startAnalysis(source, analyser);

      // Resume audio context if suspended (required on some browsers)
      if (audioContext.state === "suspended") {
        element.addEventListener(
          "play",
          () => {
            this.audioContext?.resume();
          },
          { once: true },
        );
      }
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  attachMediaStream(stream: MediaStream): void {
    if (this.attachedStream === stream) {
      return;
    }

    this.stop();
    this.resetNodes();

    try {
      const audioContext = this.ensureAudioContext();
      if (!audioContext) {
        return;
      }

      const analyser = this.createAnalyser(audioContext);
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser); // Not connected to the destination: the stream is already audible

      this.startAnalysis(source, analyser);

      // Memoize only after success so a failed attach stays retryable
      this.attachedStream = stream;
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  pause(): void {
    this.cancelLoop();
    this.options.onRms(0);
  }

  resume(): void {
    if (
      !this.isActive ||
      this.animationFrameId !== undefined ||
      !this.analyser ||
      !this.dataArray
    ) {
      return;
    }

    this.analyzeFrame();
  }

  stop(): void {
    this.isActive = false;
    this.attachedStream = undefined;
    this.cancelLoop();
    this.options.onRms(0); // Reset mouth to closed position
  }

  async cleanup(): Promise<void> {
    // Clear every reference synchronously so a prepare() racing an in-flight
    // close() creates a fresh context instead of reusing the closing one.
    this.stop();
    this.resetNodes();
    this.dataArray = undefined;

    const audioContext = this.audioContext;
    this.audioContext = undefined;

    await audioContext?.close();
  }

  /**
   * Create the context lazily so callers can attach without awaiting prepare().
   *
   * This relies on prepare() staying await-free before it assigns
   * `this.audioContext`: the void call below runs its body synchronously, so
   * the context is already visible when this returns on the same tick.
   */
  private ensureAudioContext(): AudioContext | undefined {
    if (!this.audioContext) {
      void this.prepare().catch((error) => {
        this.options.onError?.(error);
      });
    }

    return this.audioContext;
  }

  private createAnalyser(audioContext: AudioContext): AnalyserNode {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = LIPSYNC_FFT_SIZE;
    analyser.smoothingTimeConstant = LIPSYNC_SMOOTHING_TIME_CONSTANT;
    return analyser;
  }

  private startAnalysis(source: AudioNode, analyser: AnalyserNode): void {
    this.source = source;
    this.analyser = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    this.isActive = true;
    this.analyzeFrame();
  }

  private analyzeFrame(): void {
    if (!this.isActive || !this.analyser || !this.dataArray) {
      return;
    }

    this.analyser.getByteFrequencyData(this.dataArray);
    this.options.onRms(computeLipSyncRms(this.dataArray));

    this.animationFrameId = requestAnimationFrame(() => this.analyzeFrame());
  }

  private cancelLoop(): void {
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }

  private resetNodes(): void {
    if (this.source) {
      this.source.disconnect();
      this.source = undefined;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = undefined;
    }
  }
}

export function createLipSyncAnalyzer(
  options: LipSyncAnalyzerOptions,
): LipSyncAnalyzer {
  return new LipSyncAnalyzerImpl(options);
}
