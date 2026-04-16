import { useChatStore } from "../../stores/useChatStore";

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp).toLocaleTimeString();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

export function AvatarDebugPanel() {
  const { avatarDebug, isRealtimeMode } = useChatStore();

  if (
    !isRealtimeMode &&
    !avatarDebug.lastToolCall &&
    !avatarDebug.lastToolResult &&
    !avatarDebug.lastExpression &&
    !avatarDebug.lastMotion &&
    !avatarDebug.lastGaze &&
    !avatarDebug.lastEmotionCompat
  ) {
    return null;
  }

  return (
    <div className="absolute right-4 bottom-4 z-20 w-80 max-w-[calc(100%-2rem)] rounded-2xl bg-slate-950/85 text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-sm">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-wide">Avatar Debug</h3>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
            {isRealtimeMode ? "Realtime" : "Idle"}
          </span>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3 text-xs">
        <section className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Last Tool Call
          </div>
          <div className="font-medium text-slate-100">
            {avatarDebug.lastToolCall?.name ?? "-"}
          </div>
          <div className="text-slate-300">
            args: {formatValue(avatarDebug.lastToolCall?.args)}
          </div>
          <div className="text-slate-500">
            {formatTime(avatarDebug.lastToolCall?.at)}
          </div>
        </section>

        <section className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Last Tool Result
          </div>
          <div className="font-medium text-slate-100">
            {avatarDebug.lastToolResult?.name ?? "-"}
          </div>
          <div className="text-slate-300">
            applied: {formatValue(avatarDebug.lastToolResult?.appliedActions)}
          </div>
          <div className="text-slate-500">
            {formatTime(avatarDebug.lastToolResult?.at)}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Expression
            </div>
            <div>{avatarDebug.lastExpression?.expressionId ?? "-"}</div>
            <div className="text-slate-500">
              {formatTime(avatarDebug.lastExpression?.at)}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Motion
            </div>
            <div>
              {avatarDebug.lastMotion
                ? `${avatarDebug.lastMotion.group} #${avatarDebug.lastMotion.index}`
                : "-"}
            </div>
            <div className="text-slate-500">
              {formatTime(avatarDebug.lastMotion?.at)}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Gaze
            </div>
            <div>
              {avatarDebug.lastGaze
                ? `x:${avatarDebug.lastGaze.x} y:${avatarDebug.lastGaze.y}`
                : "-"}
            </div>
            <div className="text-slate-500">
              {formatTime(avatarDebug.lastGaze?.at)}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Compat Emotion
            </div>
            <div>{avatarDebug.lastEmotionCompat?.emotion ?? "-"}</div>
            <div className="text-slate-500">
              {formatTime(avatarDebug.lastEmotionCompat?.at)}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
