import { type TTSPlayer, TTSOptions } from "@charivo/core";

// Some browsers never fire `end` or `error` for an utterance (Chrome does with
// some voices), which would leave speak() pending forever. The deadline is a
// hang guard for that case only, not a limit on speech, so it is deliberately
// generous: a fixed 10 s for startup and slow voices, plus 300 ms per character
// at rate 1, about twice what the slowest common script needs (CJK, roughly
// 200-250 ms a character). The per-character part is divided by the
// utterance's rate, since a slower rate takes proportionally longer to speak;
// the base is not. The timer keeps running while speech is paused.
const SPEECH_BASE_MS = 10_000;
const SPEECH_PER_CHAR_MS = 300;

/**
 * Web TTS Player - TTS Player that uses the Web Speech API
 *
 * Uses the browser's built-in TTS feature. Its only state is the voice list
 * and the utterance whose speak() is pending; lip-sync simulation is handled
 * by the TTS Manager.
 */
class WebTTSPlayer implements TTSPlayer {
  readonly playbackMode = "web-speech" as const;
  private synthesis: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private defaultVoice?: SpeechSynthesisVoice;
  // The utterance whose speak() is still pending, if any. Only this one may
  // settle or cancel anything: a superseded utterance's late events and timer
  // are ignored, so they can never touch a newer one.
  private active: { disarm(): void } | null = null;

  constructor() {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      throw new Error("Web Speech API is not supported in this environment");
    }

    this.synthesis = window.speechSynthesis;
    this.loadVoices();
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

  private findVoice(voiceId: string): SpeechSynthesisVoice | undefined {
    return this.voices.find(
      (voice) => voice.name === voiceId || voice.voiceURI === voiceId,
    );
  }

  /**
   * Simple speak method (lip-sync is handled by the TTS Manager)
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.active?.disarm();
      this.cancelQueued();

      const utterance = new SpeechSynthesisUtterance(text);

      if (options) {
        if (options.rate !== undefined)
          utterance.rate = Math.max(0.1, Math.min(10, options.rate));
        if (options.pitch !== undefined)
          utterance.pitch = Math.max(0, Math.min(2, options.pitch));
        if (options.volume !== undefined)
          utterance.volume = Math.max(0, Math.min(1, options.volume));
        if (options.voice) {
          const selectedVoice = this.findVoice(options.voice);
          if (selectedVoice) {
            utterance.voice = selectedVoice;
          } else {
            console.warn(`Voice "${options.voice}" not found`);
          }
        } else if (this.defaultVoice) {
          utterance.voice = this.defaultVoice;
        }
      }

      // Every way this utterance ends goes through here, and only while it is
      // still the active one.
      const finish = (settle: () => void) => {
        if (this.active !== entry) return;
        this.active = null;
        clearTimeout(timer);
        settle();
      };
      // A new speak() or stop() resolves this one: being superseded or
      // stopped is a cancellation, not a failure.
      const entry = { disarm: () => finish(resolve) };

      utterance.onend = () => finish(resolve);
      utterance.onerror = (event) =>
        finish(() => reject(new Error(`TTS Error: ${event.error}`)));

      const deadlineMs =
        SPEECH_BASE_MS +
        (Array.from(text).length * SPEECH_PER_CHAR_MS) / utterance.rate;
      const timer = setTimeout(
        () =>
          finish(() => {
            // Cancel first, so the next utterance can't overlap a voice that
            // is still going.
            this.cancelQueued();
            reject(
              new Error(
                `TTS Error: utterance timed out after ${Math.round(deadlineMs / 1000)} s without an end event`,
              ),
            );
          }),
        deadlineMs,
      );

      this.active = entry;
      try {
        this.synthesis.speak(utterance);
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  async stop(): Promise<void> {
    this.active?.disarm();
    this.cancelQueued();
  }

  // `speaking` alone misses an utterance the browser is still holding before
  // it starts (Firefox queues while voices load); it would play after a stop.
  private cancelQueued(): void {
    if (this.synthesis.speaking || this.synthesis.pending) {
      this.synthesis.cancel();
    }
  }

  setVoice(voiceId: string): void {
    const voice = this.voices.find(
      (v) => v.name === voiceId || v.voiceURI === voiceId,
    );

    if (voice) {
      this.defaultVoice = voice;
    } else {
      console.warn(`Voice "${voiceId}" not found`);
      this.defaultVoice = this.voices[0];
    }
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis;
  }
}

export function createWebTTSPlayer(): TTSPlayer {
  return new WebTTSPlayer();
}
