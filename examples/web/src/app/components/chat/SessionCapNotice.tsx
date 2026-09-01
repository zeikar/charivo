"use client";

import { useChatStore } from "../../stores/useChatStore";
import { REALTIME_SESSION_MAX_MS } from "../../api/demo-limits";
import { NoticeBar } from "./NoticeBar";

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
    <NoticeBar
      tone="warning"
      role="status"
      icon="⏱️"
      message={MESSAGES[capNotice]}
      onDismiss={() => setCapNotice(null)}
    />
  );
}
