import {
  CharivoEventEmitter,
  CharivoStateError,
  createLipSyncAnalyzer,
  subscribeBrowserLifecycle,
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
 * - Lip-sync handling (Web Speech simulation; audio playback is analyzed by the manager itself)
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
  private teardownBrowserLifecycle?: () => void;

  // Only the Web Speech lip-sync simulation is needed
  private webSimulator: WebSpeechLipSyncSimulator;

  // Reads the emitter at emit time, so a later setEventEmitter() still applies.
  private readonly lipSync = createLipSyncAnalyzer({
    onRms: (rms) => this.eventEmitter?.emit("tts:lipsync:update", { rms }),
    onError: (error) =>
      console.error("TTS Manager: lip-sync analysis failed:", error),
  });

  constructor(ttsPlayer: TTSPlayer) {
    this.ttsPlayer = ttsPlayer;
    this.playbackMode = getTTSPlaybackMode(ttsPlayer);

    if (this.playbackMode === "audio" && !supportsGenerateAudio(ttsPlayer)) {
      throw new CharivoStateError(
        'TTS playback mode "audio" requires the player to implement generateAudio() so the manager can create and analyze playback for lip-sync. Implement generateAudio() or set playbackMode: "web-speech".',
      );
    }

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
        return await this.handleStatelessAudio(text, options);
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

      this.lipSync.stop();
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
   * Create the audio analysis context up front, typically from a user gesture
   * handler so browsers allow playback later. Throws on unsupported browsers.
   */
  async prepareAudio(): Promise<void> {
    this.ensureLifecycleBound();
    await this.lipSync.prepare();
  }

  /**
   * Release audio resources. Call stop() first: dispose() does not stop playback.
   */
  async dispose(): Promise<void> {
    this.webSimulator.dispose();

    this.teardownBrowserLifecycle?.();
    this.teardownBrowserLifecycle = undefined;

    try {
      await this.lipSync.cleanup();
    } catch (error) {
      throw toCharivoError(
        "dispose",
        error,
        "Failed to release TTS audio resources",
      );
    }
  }

  /**
   * Handle the Web Speech API (simulated lip-sync)
   */
  private async handleWebSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    // Emit audio start event
    this.startAudioSession();

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
   * Stateless audio handling
   */
  private async handleStatelessAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<void> {
    // Non-null: the constructor guard rejects "audio" playback mode players
    // that lack generateAudio(), so this path only runs when it exists.
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

      this.ensureLifecycleBound();
      this.lipSync.attachMediaElement(audio);

      // Emit audio start event
      this.startAudioSession();

      let isFinalized = false;
      const finalize = (next: () => void) => {
        if (isFinalized) return;
        isFinalized = true;

        if (this.currentAudioUrl) {
          URL.revokeObjectURL(this.currentAudioUrl);
          this.currentAudioUrl = null;
        }

        this.currentAudio = null;
        this.lipSync.stop();
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

  /**
   * Subscribes to browser lifecycle events once; the teardown is released in
   * dispose(). Pausing analysis while the tab is hidden closes the mouth
   * instead of freezing on the last frame.
   */
  private ensureLifecycleBound(): void {
    if (this.teardownBrowserLifecycle) {
      return;
    }

    this.teardownBrowserLifecycle = subscribeBrowserLifecycle({
      onHidden: () => this.lipSync.pause(),
      onPageHide: () => this.lipSync.pause(),
      onVisible: () => this.lipSync.resume(),
      onPageShow: () => this.lipSync.resume(),
    });
  }

  private startAudioSession(): void {
    if (this.isAudioSessionActive) {
      return;
    }
    this.isAudioSessionActive = true;
    this.eventEmitter?.emit("tts:audio:start", {});
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
