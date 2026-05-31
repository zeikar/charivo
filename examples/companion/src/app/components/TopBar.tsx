import { Icon } from "./Icon";

type Status = "dormant" | "connecting" | "connected";

function ConnectionDot({ status }: { status: Status }) {
  const cls =
    status === "connected"
      ? "conn-dot conn-connected"
      : status === "connecting"
        ? "conn-dot conn-connecting"
        : "conn-dot";
  return <span className={cls} />;
}

export function TopBar({
  name,
  status,
  onSettings,
}: {
  name: string;
  status: Status;
  onSettings: () => void;
}) {
  const label =
    status === "connecting"
      ? "connecting…"
      : status === "connected"
        ? "here with you"
        : "asleep";

  return (
    <header className="topbar">
      <div className="topbar-id">
        <ConnectionDot status={status} />
        <span className="topbar-name">{name}</span>
        <span className="topbar-status">{label}</span>
      </div>
      <button className="icon-btn" onClick={onSettings} aria-label="Settings">
        <Icon name="settings" size={19} />
      </button>
    </header>
  );
}
