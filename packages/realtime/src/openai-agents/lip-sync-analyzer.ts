interface LipSyncAnalyzerOptions {
  onRms: (rms: number) => void;
  onError?: (error: unknown) => void;
}

export class LipSyncAnalyzer {
  private audioAnalysisStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private lipSyncInterval: number | null = null;
  private pendingAudioElementPoll: number | null = null;
  private observedAudioElement: HTMLAudioElement | null = null;
  private observedAudioElementListener: (() => void) | null = null;

  constructor(private options: LipSyncAnalyzerOptions) {}

  async prepareAudioContext(): Promise<void> {
    if (this.audioContext) {
      return;
    }

    const audioContextConstructor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!audioContextConstructor) {
      throw new Error("AudioContext is not supported in this browser");
    }

    this.audioContext = new audioContextConstructor();
  }

  observeAudioElement(audioElement: HTMLAudioElement): void {
    this.detachObservedAudioElement();

    const tryAttachStream = () => {
      const stream = audioElement.srcObject;
      if (stream instanceof MediaStream) {
        this.attachStream(stream);
      }
    };

    this.observedAudioElement = audioElement;
    this.observedAudioElementListener = tryAttachStream;
    audioElement.addEventListener("loadedmetadata", tryAttachStream);
    this.pendingAudioElementPoll = window.setInterval(tryAttachStream, 50);
  }

  attachStream(stream: MediaStream): void {
    if (this.audioAnalysisStream === stream) {
      return;
    }

    this.stopAudioElementPolling();
    this.stopLipSyncAnalysis();
    this.audioAnalysisStream = stream;

    try {
      if (!this.audioContext) {
        void this.prepareAudioContext().catch((error) => {
          this.options.onError?.(error);
        });
      }

      if (!this.audioContext) {
        return;
      }

      this.audioSource?.disconnect?.();
      this.audioSource = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.audioSource.connect(this.analyser);

      this.startLipSyncAnalysis();
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  stopOutput(): void {
    this.stopLipSyncAnalysis();
  }

  pause(): void {
    this.stopLipSyncAnalysis();
  }

  resume(): void {
    if (!this.analyser || this.lipSyncInterval) {
      return;
    }

    this.startLipSyncAnalysis();
  }

  cleanup(): void {
    this.stopLipSyncAnalysis();
    this.stopAudioElementPolling();
    this.detachObservedAudioElement();

    this.audioSource?.disconnect?.();
    this.audioSource = null;

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }

    this.audioAnalysisStream = null;
    this.analyser = null;
  }

  private startLipSyncAnalysis(): void {
    if (!this.analyser) {
      return;
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.lipSyncInterval = window.setInterval(() => {
      if (!this.analyser) {
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let index = 0; index < bufferLength; index += 1) {
        const normalized = dataArray[index] / 255;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / bufferLength);
      this.options.onRms(Math.min(rms * 3, 1));
    }, 1000 / 60);
  }

  private stopLipSyncAnalysis(): void {
    if (this.lipSyncInterval) {
      clearInterval(this.lipSyncInterval);
      this.lipSyncInterval = null;
    }
    this.options.onRms(0);
  }

  private stopAudioElementPolling(): void {
    if (this.pendingAudioElementPoll) {
      clearInterval(this.pendingAudioElementPoll);
      this.pendingAudioElementPoll = null;
    }
  }

  private detachObservedAudioElement(): void {
    if (this.observedAudioElement && this.observedAudioElementListener) {
      this.observedAudioElement.removeEventListener(
        "loadedmetadata",
        this.observedAudioElementListener,
      );
    }

    this.observedAudioElement = null;
    this.observedAudioElementListener = null;
  }
}
