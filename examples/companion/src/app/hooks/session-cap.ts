/**
 * A one-shot timer that stops a billable session after a fixed wall-clock budget.
 *
 * The teardown callback is resolved when the timer FIRES, not when it is armed.
 * The cap is armed from inside the very call that starts a session, so a timer
 * that captured the callback directly would freeze whatever teardown existed at
 * that moment — before the session refs and UI state it has to act on were even
 * assigned. Keeping the latest teardown in a slot and reading it at fire time
 * means the cap always runs the current one, and `start()` never has to depend
 * on `stop()`.
 *
 * Mirrors `examples/web/src/app/hooks/session-cap.ts`; the two demos deploy
 * separately, so the module is duplicated rather than shared.
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
