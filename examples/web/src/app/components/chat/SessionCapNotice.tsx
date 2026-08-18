"use client";

import { useChatStore } from "../../stores/useChatStore";
import { REALTIME_SESSION_MAX_MS } from "../../api/demo-limits";

// Read off the same constant the cap timers use, so the copy can never claim a
// budget they do not enforce. Production is 90s; a dev build's 15 minutes reads
// better as minutes.
const CAP_LABEL =
  REALTIME_SESSION_MAX_MS >= 120_000
    ? `${Math.round(REALTIME_SESSION_MAX_MS / 60_000)} minutes`
    : `${Math.round(REALTIME_SESSION_MAX_MS / 1000)} seconds`;

const MESSAGES = {
  "realtime-session": `Voice mode stopped after ${CAP_LABEL}. This public demo caps sessions because realtime bills by wall clock — nothing broke. Start voice mode again whenever you like.`,
  "stt-recording": `Recording stopped after ${CAP_LABEL} — the same demo cap. Whatever was captured is still being transcribed.`,
} as const;

/**
 * Explains a stop that the demo's cost caps caused rather than the user (see
 * `api/demo-limits.ts`). Without it a capped session just goes quiet, which
 * reads as a bug. Dismissible, and starting again clears it on its own.
 */
export function SessionCapNotice() {
  const { capNotice, setCapNotice } = useChatStore();

  if (!capNotice) {
    return null;
  }

  return (
    <div
      role="status"
      className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-900 md:max-w-[42rem] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <span aria-hidden className="mt-px flex-shrink-0">
        ⏱️
      </span>
      <p className="flex-1">{MESSAGES[capNotice]}</p>
      <button
        type="button"
        onClick={() => setCapNotice(null)}
        aria-label="Dismiss"
        className="flex-shrink-0 cursor-pointer rounded-full px-1.5 leading-none text-amber-700 transition-colors hover:text-amber-950 dark:text-amber-300/70 dark:hover:text-amber-100"
      >
        ✕
      </button>
    </div>
  );
}
