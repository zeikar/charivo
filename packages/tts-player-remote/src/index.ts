import { TTSPlayer, TTSOptions } from "@charivo/core";

export interface RemoteTTSConfig {
  apiEndpoint?: string;
  defaultVoice?: string;
}

/**
 * Remote TTS Player - 원격 서버의 TTS API를 사용하는 플레이어
 *
 * 서버에서 TTS를 처리하고 오디오 데이터를 받아서 재생
 * 립싱크를 위한 실시간 오디오 분석 기능 포함
 */
export class RemoteTTSPlayer implements TTSPlayer {
  private apiEndpoint: string;
  private defaultVoice: string;
  private currentAudio: HTMLAudioElement | null = null;
  private eventEmitter?: { emit: (event: string, data: any) => void };
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private sourceNode?: MediaElementAudioSourceNode;
  private animationFrame?: number;

  constructor(config: RemoteTTSConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/tts";
    this.defaultVoice = config.defaultVoice || "marin";
  }

  setEventEmitter(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void {
    console.log("🔗 Remote TTS: Event emitter connected");
    this.eventEmitter = eventEmitter;
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    await this.stop();

    // Fetch audio from remote TTS API
    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: options?.voice || this.defaultVoice,
        speed: options?.rate || 1.0,
        format: "wav",
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS API failed: ${response.statusText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      if (options?.volume) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      // Emit audio start event for lip sync
      console.log("🎵 Remote TTS: Emitting tts:audio:start event", audio);
      this.eventEmitter?.emit("tts:audio:start", { audioElement: audio });

      // Setup audio analysis for lip sync
      this.setupLipSyncAnalysis(audio);

      audio.onended = () => {
        console.log("🔇 Remote TTS: Audio ended, emitting tts:audio:end event");
        this.stopLipSyncAnalysis();
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        this.eventEmitter?.emit("tts:audio:end", {});
        resolve();
      };

      audio.onerror = () => {
        this.stopLipSyncAnalysis();
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        this.eventEmitter?.emit("tts:audio:end", {});
        reject(new Error("Audio playback failed"));
      };

      audio.play().catch(reject);
    });
  }

  async stop(): Promise<void> {
    this.stopLipSyncAnalysis();

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
      this.eventEmitter?.emit("tts:audio:end", {});
    }
  }

  setVoice(voice: string): void {
    this.defaultVoice = voice;
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
  }

  private setupLipSyncAnalysis(audioElement: HTMLAudioElement): void {
    try {
      if (!this.eventEmitter) return;

      // Create audio context if it doesn't exist
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
      }

      // Create analyser node
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;

      // Create source node from audio element
      this.sourceNode =
        this.audioContext.createMediaElementSource(audioElement);
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      // Start analysis loop
      this.startAnalysisLoop();
    } catch (error) {
      console.warn("🎤 Remote TTS: Failed to setup lip sync analysis:", error);
    }
  }

  private startAnalysisLoop(): void {
    if (!this.analyser || !this.eventEmitter) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const analyze = () => {
      if (!this.analyser || !this.eventEmitter || !this.currentAudio) return;

      this.analyser.getByteFrequencyData(dataArray);

      // Focus on lower frequencies for speech (0-4000 Hz range)
      const speechRange = Math.floor(bufferLength * 0.3);
      let sum = 0;
      let count = 0;

      for (let i = 0; i < speechRange; i++) {
        sum += dataArray[i];
        count++;
      }

      const average = count > 0 ? sum / count : 0;
      const normalizedRms = Math.min(average / 255, 1.0);

      // Emit lip sync update
      this.eventEmitter.emit("tts:lipsync:update", { rms: normalizedRms });

      this.animationFrame = requestAnimationFrame(analyze);
    };

    analyze();
  }

  private stopLipSyncAnalysis(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }

    if (this.eventEmitter) {
      this.eventEmitter.emit("tts:lipsync:update", { rms: 0 });
    }

    // Note: We don't close the AudioContext as it might be reused
    // The source node will be garbage collected when audio element is destroyed
    this.sourceNode = undefined;
    this.analyser = undefined;
  }
}

export function createRemoteTTSPlayer(
  config?: RemoteTTSConfig,
): RemoteTTSPlayer {
  return new RemoteTTSPlayer(config);
}
