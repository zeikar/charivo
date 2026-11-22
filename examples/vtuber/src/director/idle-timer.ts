import type { IdleEvent, ShowEventSource } from "./types";

/**
 * Emits `idle` once `idleAfterMs` after arm(). The Director arms it when a
 * queue drain finds nothing to speak and cancels it when a line starts.
 */
export interface IdleTimer extends ShowEventSource<IdleEvent> {
  /** Starts the wait, restarting it if one is pending. */
  arm(): void;
  cancel(): void;
}

export function createIdleTimer(idleAfterMs: number): IdleTimer {
  let emit: ((event: IdleEvent) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return {
    start(next) {
      emit = next;
    },
    stop() {
      cancel();
      emit = null;
    },
    arm() {
      cancel();
      if (emit === null) return;
      const fire = emit;
      timer = setTimeout(() => {
        timer = null;
        fire({ kind: "idle" });
      }, idleAfterMs);
    },
    cancel,
  };
}
