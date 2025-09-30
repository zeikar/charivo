import { TTSPlayer, TTSOptions } from "@charivo/core";

export class WebTTSPlayer implements TTSPlayer {
  private synthesis: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private eventEmitter?: { emit: (event: string, data: any) => void };
  private lipSyncIntervals: number[] = [];

  constructor() {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      throw new Error("Web Speech API is not supported in this environment");
    }

    this.synthesis = window.speechSynthesis;
    this.loadVoices();
  }

  setEventEmitter(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void {
    console.log("🔗 Web TTS: Event emitter connected");
    this.eventEmitter = eventEmitter;
  }

  private loadVoices(): void {
    const voices = this.synthesis.getVoices();
    if (voices.length > 0) {
      this.voices = voices;
    } else {
      this.synthesis.addEventListener("voiceschanged", () => {
        this.voices = this.synthesis.getVoices();
      });
    }
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log("🎵 Web TTS: ✅ SPEAK CALLED", {
        text: text.substring(0, 50),
        hasEventEmitter: !!this.eventEmitter,
      });

      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);

      if (options) {
        if (options.rate)
          utterance.rate = Math.max(0.1, Math.min(10, options.rate));
        if (options.pitch)
          utterance.pitch = Math.max(0, Math.min(2, options.pitch));
        if (options.volume)
          utterance.volume = Math.max(0, Math.min(1, options.volume));
        if (options.voice) {
          const voice = this.voices.find(
            (v) => v.name === options.voice || v.voiceURI === options.voice,
          );
          if (voice) utterance.voice = voice;
        }
      }

      // Simulate lip sync for Web Speech API
      console.log("🎵 Web TTS: ✅ STARTING SIMULATED LIP SYNC");
      if (this.eventEmitter) {
        console.log(
          "🎵 Web TTS: ✅ EVENT EMITTER AVAILABLE - starting simulation",
        );
        this.simulateLipSync(text, utterance.rate || 1);
      } else {
        console.warn("⚠️ Web TTS: NO EVENT EMITTER - lip sync will not work");
      }

      utterance.onend = () => {
        console.log("🔇 Web TTS: ✅ SPEECH ENDED - emitting tts:audio:end");
        this.eventEmitter?.emit("tts:audio:end", {});
        resolve();
      };

      utterance.onerror = (event) => {
        console.error("❌ Web TTS: Speech synthesis error", event.error);
        this.eventEmitter?.emit("tts:audio:end", {});
        reject(new Error(`TTS Error: ${event.error}`));
      };

      console.log("🎵 Web TTS: ✅ STARTING SPEECH SYNTHESIS");
      this.synthesis.speak(utterance);
    });
  }

  async stop(): Promise<void> {
    if (this.synthesis.speaking) {
      this.synthesis.cancel();
    }
    this.clearLipSyncIntervals();
    this.eventEmitter?.emit("tts:audio:end", {});
  }

  setVoice(voiceId: string): void {
    const voice = this.voices.find(
      (v) => v.name === voiceId || v.voiceURI === voiceId,
    );
    if (!voice) {
      console.warn(`Voice "${voiceId}" not found`);
    }
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis;
  }

  private simulateLipSync(text: string, rate: number): void {
    console.log("🎵 Web TTS: ✅ SIMULATE LIP SYNC STARTED", {
      textLength: text.length,
      rate,
    });

    // Clear any existing intervals
    this.clearLipSyncIntervals();

    // Create a dummy audio element for lip sync simulation
    const dummyAudio = document.createElement("audio");
    dummyAudio.preload = "none";

    console.log("🎵 Web TTS: ✅ EMITTING tts:audio:start event");
    if (this.eventEmitter) {
      this.eventEmitter.emit("tts:audio:start", { audioElement: dummyAudio });
      console.log("🎵 Web TTS: ✅ tts:audio:start event emitted successfully");
    } else {
      console.error(
        "❌ Web TTS: No event emitter available for tts:audio:start",
      );
    }

    // Simulate lip movement based on text characteristics
    const words = text.split(/\s+/);
    const baseInterval = 120 / rate; // Base timing in ms
    let currentTime = 0;

    words.forEach((word) => {
      const intervalId = window.setTimeout(() => {
        // Simulate mouth movement based on word characteristics
        const vowels = (word.match(/[aeiouAEIOU]/g) || []).length;

        // More vowels = more mouth opening (increased base intensity for visibility)
        const intensity = Math.min(0.8 + vowels * 0.2, 1.0); // Much higher base intensity

        // Emit simulated RMS values through a custom event
        console.log(
          `👄 Web TTS: ✅ EMITTING tts:lipsync:update - word: "${word}", intensity: ${intensity.toFixed(3)}`,
        );
        if (this.eventEmitter) {
          this.eventEmitter.emit("tts:lipsync:update", { rms: intensity });
          console.log(`👄 Web TTS: ✅ tts:lipsync:update emitted successfully`);
        } else {
          console.error(`❌ Web TTS: No event emitter for tts:lipsync:update`);
        }

        // Fade out the intensity over the word duration
        const fadeSteps = 3;
        for (let step = 1; step <= fadeSteps; step++) {
          const fadeId = window.setTimeout(
            () => {
              const fadedIntensity = intensity * (1 - step / fadeSteps);
              this.eventEmitter?.emit("tts:lipsync:update", {
                rms: fadedIntensity,
              });
            },
            (baseInterval * step) / fadeSteps,
          );

          this.lipSyncIntervals.push(fadeId);
        }
      }, currentTime);

      this.lipSyncIntervals.push(intervalId);
      currentTime += baseInterval + (word.length * 20) / rate; // Adjust timing based on word length
    });
  }

  private clearLipSyncIntervals(): void {
    this.lipSyncIntervals.forEach((id) => clearTimeout(id));
    this.lipSyncIntervals = [];
  }
}

export function createWebTTSPlayer(): WebTTSPlayer {
  return new WebTTSPlayer();
}
