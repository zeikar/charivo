import type { Phase } from "../lib/hearth-theme";

export function VoiceOrb({
  phase,
  onTalk,
}: {
  phase: Phase;
  onTalk?: () => void;
}) {
  const label =
    phase === "listening"
      ? "listening"
      : phase === "thinking"
        ? "thinking"
        : "";

  return (
    <button
      className={"voicehint phase-" + phase}
      onClick={onTalk}
      disabled={onTalk === undefined}
      aria-label={onTalk !== undefined ? "Wake her" : undefined}
    >
      <span className="vh-orb">
        <span className="vh-core" />
        <span className="vh-ring" />
      </span>
      {label && <span className="vh-label">{label}</span>}
    </button>
  );
}
