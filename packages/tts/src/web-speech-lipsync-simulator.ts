import type { CharivoEventEmitter } from "@charivo/core";

/**
 * Web Speech Lip Sync Simulator
 *
 * Text-based lip-sync simulation for the Web Speech API
 * Simulates mouth movement based on the number of vowels and length of each word
 */
export class WebSpeechLipSyncSimulator {
  private intervals: number[] = [];
  private eventEmitter?: CharivoEventEmitter;

  constructor(eventEmitter?: CharivoEventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start text-based lip-sync simulation
   */
  startSimulation(text: string, rate: number = 1): void {
    this.clearIntervals();

    if (!this.eventEmitter) return;

    const words = text.split(/\s+/);
    const baseInterval = 120 / rate; // Base timing in ms
    let currentTime = 0;

    words.forEach((word) => {
      const intervalId = window.setTimeout(() => {
        // Calculate intensity based on vowel count
        const vowels = (word.match(/[aeiouAEIOU]/g) || []).length;
        const intensity = Math.min(0.3 + vowels * 0.15, 1.0);

        // Emit lip sync update
        this.eventEmitter?.emit("tts:lipsync:update", { rms: intensity });

        // Create fade-out effect
        this.createFadeEffect(intensity, baseInterval);
      }, currentTime);

      this.intervals.push(intervalId);
      currentTime += baseInterval + (word.length * 20) / rate;
    });
  }

  /**
   * Create fade-out effect
   */
  private createFadeEffect(intensity: number, duration: number): void {
    const fadeSteps = 3;

    for (let step = 1; step <= fadeSteps; step++) {
      const fadeId = window.setTimeout(
        () => {
          const fadedIntensity = intensity * (1 - step / fadeSteps);
          this.eventEmitter?.emit("tts:lipsync:update", {
            rms: fadedIntensity,
          });
        },
        (duration * step) / fadeSteps,
      );

      this.intervals.push(fadeId);
    }
  }

  /**
   * Stop simulation
   */
  stopSimulation(): void {
    this.clearIntervals();

    if (this.eventEmitter) {
      this.eventEmitter.emit("tts:lipsync:update", { rms: 0 });
    }
  }

  /**
   * Clear intervals
   */
  private clearIntervals(): void {
    this.intervals.forEach((id) => clearTimeout(id));
    this.intervals = [];
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopSimulation();
  }
}
