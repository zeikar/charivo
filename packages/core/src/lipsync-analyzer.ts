/**
 * Shared lip sync audio analysis: the single mouth-open computation used across the repo.
 *
 * The output is already the final 0..1 mouth value; renderers map it to their
 * mouth parameter without further gain. Constants were tuned offline against
 * Gemini TTS lines replayed through a 48 kHz context at 60 fps.
 */

/** ~21 ms of samples at 48 kHz: covers a whole 60 fps frame of audio. */
export const LIPSYNC_FFT_SIZE = 1024;

/** Below about -50 dBFS is silence or line noise: the mouth target is 0. */
const GATE_AMPLITUDE = 10 ** (-50 / 20);
/**
 * The loudness reference never drops below -40 dBFS, so near-silence is not
 * normalized up to a wide-open mouth, while a voice ~20 dB quieter than
 * typical TTS still spans the full range.
 */
const PEAK_FLOOR_AMPLITUDE = 10 ** (-40 / 20);
/**
 * The reference follows the loudest recent level and decays 6 dB per second, so
 * loud and quiet voices both use the range and only the louder syllables open fully.
 */
const PEAK_DECAY_DB_PER_SECOND = 6;
/**
 * Applied to level / peak: above 1 it expands the gap between syllables, so
 * consonants and pauses read as a near-closed mouth instead of a half-open one.
 */
const OPENNESS_EXPONENT = 1.5;
/** Opens fast enough to land on the syllable... */
const ATTACK_MS = 35;
/** ...and closes fast enough to show the gap before the next one. */
const RELEASE_MS = 80;

export interface LipSyncEnvelope {
  level: number;
  peak: number;
}

export function createLipSyncEnvelope(): LipSyncEnvelope {
  return { level: 0, peak: PEAK_FLOOR_AMPLITUDE };
}

/**
 * Advance the envelope by one frame of time-domain samples and return the mouth-open value (0..1).
 */
export function stepLipSyncEnvelope(
  envelope: LipSyncEnvelope,
  samples: Float32Array,
  deltaMs: number,
): number {
  // An empty window has no level; dividing by its length would poison the peak with NaN.
  if (samples.length === 0) {
    return envelope.level;
  }

  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  const rms = Math.sqrt(sum / samples.length);

  envelope.peak = Math.max(
    rms,
    envelope.peak * 10 ** ((-PEAK_DECAY_DB_PER_SECOND * deltaMs) / 20000),
    PEAK_FLOOR_AMPLITUDE,
  );

  const target =
    rms < GATE_AMPLITUDE ? 0 : (rms / envelope.peak) ** OPENNESS_EXPONENT;
  const timeConstantMs = target > envelope.level ? ATTACK_MS : RELEASE_MS;
  envelope.level +=
    (target - envelope.level) * (1 - Math.exp(-deltaMs / timeConstantMs));

  return envelope.level;
}

/** Used when there is no previous frame to measure against. */
const NOMINAL_FRAME_MS = 1000 / 60;
/**
 * A longer gap is a stall (a hidden tab pauses rAF while `<audio>` keeps
 * playing), not elapsed animation time: counting all of it would finish the
 * attack in one frame and snap the mouth open. Three 60 fps frames still
 * covers real frame rates down to 20 fps.
 */
const MAX_FRAME_MS = 50;

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
  private dataArray?: Float32Array<ArrayBuffer>;
  private envelope = createLipSyncEnvelope();
  private lastFrameTime?: number;
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
    // The mouth is reported closed, so resume() opens it again from closed.
    this.resetEnvelope();
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
    return analyser;
  }

  private startAnalysis(source: AudioNode, analyser: AnalyserNode): void {
    this.source = source;
    this.analyser = analyser;
    this.dataArray = new Float32Array(analyser.fftSize);
    this.resetEnvelope();
    this.isActive = true;
    this.analyzeFrame();
  }

  private analyzeFrame(): void {
    if (!this.isActive || !this.analyser || !this.dataArray) {
      return;
    }

    const now = performance.now();
    const deltaMs =
      this.lastFrameTime === undefined
        ? NOMINAL_FRAME_MS
        : Math.min(now - this.lastFrameTime, MAX_FRAME_MS);
    this.lastFrameTime = now;

    this.analyser.getFloatTimeDomainData(this.dataArray);
    this.options.onRms(
      stepLipSyncEnvelope(this.envelope, this.dataArray, deltaMs),
    );

    this.animationFrameId = requestAnimationFrame(() => this.analyzeFrame());
  }

  private resetEnvelope(): void {
    this.envelope = createLipSyncEnvelope();
    this.lastFrameTime = undefined;
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
