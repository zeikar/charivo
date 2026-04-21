import React from "react";
import type { RealtimeTurnStatus } from "../../types/chat";

type RealtimeStatusBadgeProps = {
  status: RealtimeTurnStatus;
  error: string | null;
  visible: boolean;
};

const STATUS_STYLES: Record<
  Exclude<RealtimeTurnStatus, "idle" | "interrupted">,
  { label: string; className: string }
> = {
  connecting: {
    label: "Connecting",
    className:
      "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800/70 dark:text-slate-200 dark:border-slate-700",
  },
  listening: {
    label: "Listening",
    className:
      "bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800",
  },
  responding: {
    label: "Responding",
    className:
      "bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800",
  },
  reconnecting: {
    label: "Reconnecting",
    className:
      "bg-zinc-100 text-zinc-700 border border-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-200 dark:border-zinc-700",
  },
};

export function RealtimeStatusBadge({
  status,
  error,
  visible,
}: RealtimeStatusBadgeProps) {
  if (!visible) {
    return null;
  }

  if (error) {
    return (
      <div
        data-testid="realtime-status-badge"
        className="mt-1 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800"
      >
        Error
      </div>
    );
  }

  if (status === "idle" || status === "interrupted") {
    return null;
  }

  const badge = STATUS_STYLES[status];

  return (
    <div
      data-testid="realtime-status-badge"
      className={`mt-1 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.className}`}
    >
      {badge.label}
    </div>
  );
}
