import {
  CharivoEventEmitter,
  TTSPlayer,
  TTSPlaybackMode,
  TTSOptions,
  TTSManager,
  toCharivoError,
} from "@charivo/core";
import { WebSpeechLipSyncSimulator } from "./web-speech-lipsync-simulator";
import {
  getTTSAudioMimeType,
  getTTSPlaybackMode,
  supportsGenerateAudio,
} from "./tts-utils";

/**
 * TTS Manager - Class responsible for managing the state of a TTS session
 *
 * Responsibilities:
 * - TTS Player management and wrapping
 * - Audio playback and control
 * - Lip-sync handling (Web Speech simulation; Audio is handled automatically by the Live2D SDK)
 * - Event emission (tts:audio:start, tts:lipsync:update, tts:audio:end)
 * - Session state management
 */
export class TTSManagerImpl implements TTSManager {
  private ttsPlayer: TTSPlayer;
  private eventEmitter?: CharivoEventEmitter;
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private playbackMode: TTSPlaybackMode;
  private isAudioSessionActive = false;

  // Only the Web Speech lip-sync simulation is needed
  private webSimulator: WebSpeechLipSyncSimulator;

  constructor(ttsPlayer: TTSPlayer) {
    this.ttsPlayer = ttsPlayer;
    this.playbackMode = getTTSPlaybackMode(ttsPlayer);

    // Initialize Web Speech simulator
    this.webSimulator = new WebSpeechLipSyncSimulator();
  }

  /**
   * Set the event emitter
   */
  setEventEmitter(eventEmitter: CharivoEventEmitter): void {
    this.eventEmitter = eventEmitter;

    // Connect event emitter to Web Speech simulator
    this.webSimulator = new WebSpeechLipSyncSimulator(eventEmitter);
  }

  /**
   * Convert text to speech and play it
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    try {
      await this.stop().catch((error) => {
        throw toCharivoError("provider", error, "Failed to stop active TTS");
      });

      if (this.playbackMode === "web-speech") {
        return await this.handleWebSpeech(text, options);
      } else {
        return await this.handleAudioSpeech(text, options);
      }
    } catch (error) {
      throw toCharivoError("provider", error, "Failed to speak text");
    }
  }

  /**
   * Stop the currently playing speech
   */
  async stop(): Promise<void> {
    this.webSimulator.stopSimulation();

    try {
      await this.ttsPlayer.stop();
    } catch (error) {
      console.warn("⚠️ TTS Manager: Failed to stop player cleanly", error);
      throw toCharivoError("provider", error, "Failed to stop TTS");
    } finally {
      if (this.currentAudio) {
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.pause();
        this.currentAudio = null;
      }

      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = null;
      }

      this.endAudioSession();
    }
  }

  /**
   * Set the voice
   */
  setVoice(voice: string): void {
    this.ttsPlayer.setVoice(voice);
  }

  /**
   * Check support
   */
  isSupported(): boolean {
    return this.ttsPlayer.isSupported();
  }

  /**
   * Handle the Web Speech API (simulated lip-sync)
   */
  private async handleWebSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    // Create dummy audio element for consistent interface
    const dummyAudio = document.createElement("audio");
    dummyAudio.preload = "none";

    // Emit audio start event
    this.startAudioSession(dummyAudio);

    // Compute the effective rate using the same clamp the Web Speech player applies,
    // so the lip-sync simulation speed matches the actual playback rate.
    const effectiveRate =
      options?.rate !== undefined
        ? Math.max(0.1, Math.min(10, options.rate))
        : 1;

    // Start simulated lip sync using dedicated component
    this.webSimulator.startSimulation(text, effectiveRate);

    // Delegate to player and wait for completion
    try {
      await this.ttsPlayer.speak(text, options);
    } finally {
      this.webSimulator.stopSimulation();
      this.endAudioSession();
    }
  }

  /**
   * Handle audio-based TTS (real-time audio analysis)
   */
  private async handleAudioSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    // Try to use generateAudio if available (stateless approach)
    if (supportsGenerateAudio(this.ttsPlayer)) {
      return this.handleStatelessAudio(text, options);
    }

    // Fallback: use legacy speak method
    this.startAudioSession();
    try {
      await this.ttsPlayer.speak(text, options);
    } finally {
      this.endAudioSession();
    }
  }

  /**
   * Stateless audio handling
   */
  private async handleStatelessAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    const audioData = await this.ttsPlayer.generateAudio!(text, options).catch(
      (error) =>
        Promise.reject(
          toCharivoError("provider", error, "Failed to generate TTS audio"),
        ),
    );
    const mimeType = getTTSAudioMimeType(this.ttsPlayer);
    const blob = new Blob([audioData], { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      this.currentAudioUrl = audioUrl;

      if (options?.volume !== undefined) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      // Emit audio start event
      this.startAudioSession(audio);

      // Live2D SDK handles lip sync automatically from audio element

      let isFinalized = false;
      const finalize = (next: () => void) => {
        if (isFinalized) return;
        isFinalized = true;

        if (this.currentAudioUrl) {
          URL.revokeObjectURL(this.currentAudioUrl);
          this.currentAudioUrl = null;
        }

        this.currentAudio = null;
        this.endAudioSession();
        next();
      };

      audio.onended = () => {
        finalize(resolve);
      };

      audio.onerror = () => {
        finalize(() => reject(new Error("Audio playback failed")));
      };

      audio.play().catch((error) => {
        finalize(() =>
          reject(
            error instanceof Error ? error : new Error("Audio playback failed"),
          ),
        );
      });
    });
  }

  private startAudioSession(audioElement?: HTMLAudioElement): void {
    if (this.isAudioSessionActive) {
      return;
    }
    this.isAudioSessionActive = true;
    this.eventEmitter?.emit("tts:audio:start", { audioElement });
  }

  private endAudioSession(): void {
    if (!this.isAudioSessionActive) {
      return;
    }
    this.isAudioSessionActive = false;
    this.eventEmitter?.emit("tts:audio:end", {});
  }
}

/**
 * Helper function to create a TTS Manager
 */
export function createTTSManager(ttsPlayer: TTSPlayer): TTSManager {
  return new TTSManagerImpl(ttsPlayer);
}
