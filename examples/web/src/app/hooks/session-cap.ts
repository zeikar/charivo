/**
 * A one-shot timer that stops a billable session after a fixed wall-clock budget.
 *
 * The teardown callback is resolved when the timer FIRES, not when it is armed.
 * That distinction is the whole point of this module. The React callbacks that
 * tear a session down guard on UI state — `isRealtimeMode`, `isRecording` — and
 * at the instant a cap is armed those are still `false`, because arming happens
 * inside the very call that is starting the session. A timer that captured the
 * callback directly would fire a closure whose own guard turns it into a no-op,
 * and the cap would silently never stop anything.
 *
 * So: keep the latest teardown here, and read it at fire time.
 */
export interface SessionCap {
  /** Point the cap at the current teardown. Call whenever it changes. */
  update(teardown: () => void | Promise<void>): void;
  /** Start (or restart) the countdown. Replaces any pending timer. */
  arm(ms: number): void;
  /** Cancel a pending countdown. Safe when nothing is armed. */
  clear(): void;
}

export function createSessionCap(): SessionCap {
  let teardown: (() => void | Promise<void>) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    update(next) {
      teardown = next;
    },
    arm(ms) {
      clear();
      timer = setTimeout(() => {
        timer = null;
        void teardown?.();
      }, ms);
    },
    clear,
  };
}
