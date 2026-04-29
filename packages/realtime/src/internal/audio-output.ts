import type { EventMap } from "@charivo/core";

type EmitEvent = <K extends keyof EventMap>(
  event: K,
  payload: EventMap[K],
) => void;

export class RealtimeAudioOutput {
  private active = false;

  constructor(private readonly emit: EmitEvent) {}

  isActive(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.emit("tts:audio:start", {});
  }

  end(): void {
    if (!this.active) {
      return;
    }

    this.active = false;
    this.emit("tts:lipsync:update", { rms: 0 });
    this.emit("tts:audio:end", {});
  }
}
