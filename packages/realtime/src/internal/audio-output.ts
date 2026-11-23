import type { EventMap } from "@charivo/core";

type EmitEvent = <K extends keyof EventMap>(
  event: K,
  payload: EventMap[K],
) => void;

export class RealtimeAudioOutput {
  private active = false;
  private delivering = false;
  private readonly pending: Array<() => void> = [];

  constructor(
    private readonly emit: EmitEvent,
    /** Fired on transitions only; required so `audioPlaying` cannot go stale. */
    private readonly onChange: (playing: boolean) => void,
  ) {}

  isActive(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.deliver(() => {
      this.emit("tts:audio:start", {});
      this.onChange(true);
    });
  }

  end(): void {
    if (!this.active) {
      return;
    }

    this.active = false;
    this.deliver(() => {
      this.emit("tts:lipsync:update", { rms: 0 });
      this.emit("tts:audio:end", {});
      this.onChange(false);
    });
  }

  /**
   * A listener may interrupt the output from inside a notification. Delivering
   * the nested end right away would reach the listeners after it before the
   * start it answers, so notifications run strictly one after another.
   */
  private deliver(notify: () => void): void {
    this.pending.push(notify);
    if (this.delivering) {
      return;
    }

    this.delivering = true;
    try {
      let next: (() => void) | undefined;
      while ((next = this.pending.shift())) {
        next();
      }
    } finally {
      this.delivering = false;
      this.pending.length = 0;
    }
  }
}
