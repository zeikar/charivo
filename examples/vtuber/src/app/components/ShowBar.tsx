import type { DirectorSnapshot, ShowPlan } from "../../director";
import type { CharacterStatus, ShowLifecycle } from "../hooks/useVtuberShow";
import { describeSegment } from "../lib/show-plan";
import { FOCUS_RING } from "./focus-ring";

const STATUS_STYLES: Record<
  CharacterStatus,
  { label: string; pill: string; dot: string }
> = {
  speaking: {
    label: "Speaking",
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  thinking: {
    label: "Thinking",
    pill: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  idle: {
    label: "Idle",
    pill: "bg-gray-100 text-gray-600 ring-gray-200",
    dot: "bg-gray-400",
  },
  failed: {
    label: "Failed",
    pill: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
};

type ShowBarProps = {
  status: CharacterStatus;
  snapshot: DirectorSnapshot | null;
  plan: ShowPlan;
  lifecycle: ShowLifecycle;
  canStart: boolean;
  canStop: boolean;
  onStart(): void;
  onStop(): void;
};

export function ShowBar({
  status,
  snapshot,
  plan,
  lifecycle,
  canStart,
  canStop,
  onStart,
  onStop,
}: ShowBarProps) {
  const style = STATUS_STYLES[status];
  const segmentLabel =
    snapshot?.status === "running" && snapshot.segmentIndex !== null
      ? describeSegment(plan, snapshot.segmentIndex)
      : "Off air";

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <h1 className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-xl font-bold leading-tight text-transparent md:text-2xl">
          Charivo VTuber
        </h1>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${style.pill}`}
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${style.dot}`} />
          {style.label}
        </span>
        <span aria-hidden className="hidden h-6 w-px bg-gray-200 sm:block" />
        <p className="min-w-0 text-sm font-medium text-gray-700">
          {segmentLabel}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart}
            className={`cursor-pointer rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-blue-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
          >
            {lifecycle === "starting" ? "Starting…" : "Start"}
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={!canStop}
            className={`cursor-pointer rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
          >
            {lifecycle === "stopping" ? "Stopping…" : "Stop"}
          </button>
        </div>
      </div>
    </header>
  );
}
