import type { ExternalShowEvent, ShowEventSource } from "../../director";

export interface ScriptEntry {
  /** Time from start() to this event. */
  atMs: number;
  event: ExternalShowEvent;
}

/**
 * Plays `script` once from start(). `isEnabled` is read when each entry's
 * turn comes, so a toggle flipped mid-show takes effect without a restart;
 * an entry whose turn comes while it is off is skipped, not held back.
 */
export function createScriptedSource(
  script: readonly ScriptEntry[],
  isEnabled: () => boolean,
): ShowEventSource<ExternalShowEvent> {
  let timers: ReturnType<typeof setTimeout>[] = [];

  return {
    start(emit) {
      timers = script.map(({ atMs, event }) =>
        setTimeout(() => {
          if (isEnabled()) emit(event);
        }, atMs),
      );
    },
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers = [];
    },
  };
}
