import { REALTIME_SESSION_MAX_MS } from "../api/demo-limits";

// Read off the same constant the cap timer uses, so the copy can never claim a
// budget the timer does not enforce. Production is 90s; a dev build's 15 minutes
// reads better as minutes.
const CAP_LABEL =
  REALTIME_SESSION_MAX_MS >= 120_000
    ? `${Math.round(REALTIME_SESSION_MAX_MS / 60_000)} minutes`
    : `${Math.round(REALTIME_SESSION_MAX_MS / 1000)} seconds`;

/**
 * Shown when the wall-clock cap — not the visitor, and not an error — is what
 * ended the session. Without it a capped session just goes quiet, which reads
 * as a crash. Non-interactive: reconnecting is the dismissal, and it never
 * takes pointer events away from the orb underneath.
 */
export function SessionCapNotice({
  show,
  name,
}: {
  show: boolean;
  name: string;
}) {
  if (!show) return null;
  return (
    <div className="cap-notice" role="status">
      <p className="cap-notice-title">{name} drifted off</p>
      <p className="cap-notice-body">
        This demo caps each session at {CAP_LABEL} to keep its API bill sane —
        nothing broke. Tap the orb to wake her again; she remembers.
      </p>
    </div>
  );
}
