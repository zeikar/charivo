/**
 * Web Speech Lip Sync Simulator
 *
 * Web Speech API용 텍스트 기반 립싱크 시뮬레이션
 * 단어의 모음 개수와 길이를 기반으로 입 움직임을 시뮬레이션
 */
export class WebSpeechLipSyncSimulator {
  private intervals: number[] = [];
  private eventEmitter?: { emit: (event: string, data: any) => void };

  constructor(eventEmitter?: { emit: (event: string, data: any) => void }) {
    this.eventEmitter = eventEmitter;
  }

  /**
   * 텍스트 기반 립싱크 시뮬레이션 시작
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
   * 페이드 아웃 효과 생성
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
   * 시뮬레이션 중지
   */
  stopSimulation(): void {
    this.clearIntervals();

    if (this.eventEmitter) {
      this.eventEmitter.emit("tts:lipsync:update", { rms: 0 });
    }
  }

  /**
   * 인터벌 정리
   */
  private clearIntervals(): void {
    this.intervals.forEach((id) => clearTimeout(id));
    this.intervals = [];
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    this.stopSimulation();
  }
}
