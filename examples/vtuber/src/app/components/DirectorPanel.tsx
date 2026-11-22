import { useMemo, type ReactNode } from "react";

import type {
  DirectorLogEntry,
  DirectorSnapshot,
  DirectorStatus,
  Line,
  ShowEvent,
  ShowPlan,
} from "../../director";
import { describeDecision, eventsByLine, type ShowLog } from "../lib/show-log";
import { describeSegment } from "../lib/show-plan";
import { FOCUS_RING } from "./focus-ring";

const DARK_FOCUS_RING = `${FOCUS_RING} focus-visible:ring-offset-slate-950`;

const STATUS_STYLES: Record<DirectorStatus, { label: string; pill: string }> = {
  ready: { label: "Ready", pill: "bg-slate-400/15 text-slate-300" },
  running: { label: "Running", pill: "bg-emerald-400/15 text-emerald-300" },
  finished: { label: "Finished", pill: "bg-sky-400/15 text-sky-300" },
  stopped: { label: "Stopped", pill: "bg-slate-400/15 text-slate-300" },
  failed: { label: "Failed", pill: "bg-red-400/15 text-red-300" },
};

const TONES = {
  neutral: "bg-slate-400/15 text-slate-300",
  info: "bg-sky-400/15 text-sky-300",
  good: "bg-emerald-400/15 text-emerald-300",
  warn: "bg-amber-400/15 text-amber-300",
  bad: "bg-red-400/15 text-red-300",
} as const;

type Tone = keyof typeof TONES;

const SOURCE_LABELS: Record<Line["source"], string> = {
  chat: "Chat line",
  agent: "Agent line",
  idle: "Idle filler",
  segment: "Segment cue",
};

// The idle cue lives only in the line's prompt, behind its envelope tag.
function idleCueText(line: Line): string {
  return line.prompt.replace(/^\[DIRECTOR\]\s*/, "");
}

function describeEvent(event: ShowEvent, line: Line | null): string {
  switch (event.kind) {
    case "chat":
      return `${event.highlighted ? "Super chat" : "Chat"} from ${event.viewer}: ${event.text}`;
    case "agent":
      return `Event from ${event.source}, ${event.priority} priority: ${event.text}`;
    case "segment":
      return `Cue for ${event.segment.title}: ${event.segment.cue}`;
    case "idle":
      return line ? `Idle cue: ${idleCueText(line)}` : "Idle tick";
  }
}

function describeLine(line: Line, events: Map<string, ShowEvent>): string {
  // The idle cue is on the line itself, so it needs no event.
  if (line.source === "idle") return `Idle cue: ${idleCueText(line)}`;
  const event = events.get(line.id);
  switch (event?.kind) {
    case "chat":
      return `Chat from ${event.viewer}: ${event.text}`;
    case "agent":
      return `${event.source}: ${event.text}`;
    case "segment":
      return `Cue for ${event.segment.title}`;
    default:
      // The decision that made this line has fallen off the capped log.
      return SOURCE_LABELS[line.source];
  }
}

interface EntryView {
  tags: { label: string; tone: Tone }[];
  text: string;
  /** A failed line's failure message. */
  failure?: string;
}

function describeEntry(
  entry: DirectorLogEntry,
  events: Map<string, ShowEvent>,
  plan: ShowPlan,
): EntryView {
  switch (entry.kind) {
    case "decision": {
      const { decision } = entry;
      const accepted = decision.kind === "ignore" ? null : decision.line;
      const tone: Tone =
        decision.kind === "ignore"
          ? "neutral"
          : decision.kind === "interrupt"
            ? "bad"
            : "info";
      return {
        tags: [{ label: describeDecision(decision), tone }],
        text: describeEvent(entry.event, accepted),
      };
    }
    case "line-start":
      return {
        tags: [{ label: "Started", tone: "good" }],
        text: describeLine(entry.line, events),
      };
    case "line-end": {
      const { result } = entry;
      const tags: EntryView["tags"] =
        result.status === "completed"
          ? [{ label: "Completed", tone: "good" }]
          : result.status === "cancelled"
            ? [{ label: "Cancelled", tone: "warn" }]
            : [{ label: "Failed", tone: "bad" }];
      if (entry.leak) tags.push({ label: "Cue leak", tone: "bad" });
      return {
        tags,
        text: describeLine(entry.line, events),
        failure:
          result.status === "failed" ? (result.error ?? "unknown") : undefined,
      };
    }
    case "line-dropped":
      return {
        tags: [{ label: "Dropped", tone: "warn" }],
        text: `${describeLine(entry.line, events)} (${entry.reason})`,
      };
    case "segment":
      return {
        tags: [{ label: "Segment", tone: "info" }],
        text: describeSegment(plan, entry.index),
      };
    case "error":
      return { tags: [{ label: "Error", tone: "bad" }], text: entry.message };
  }
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold tracking-wide text-slate-400">
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex cursor-pointer items-center gap-2.5 rounded-full text-sm text-slate-200 ${DARK_FOCUS_RING}`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-blue-500" : "bg-slate-600"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

type DirectorPanelProps = {
  snapshot: DirectorSnapshot | null;
  log: ShowLog;
  plan: ShowPlan;
  scriptedViewers: boolean;
  scriptedGameEvents: boolean;
  onScriptedViewersChange(enabled: boolean): void;
  onScriptedGameEventsChange(enabled: boolean): void;
};

export function DirectorPanel({
  snapshot,
  log,
  plan,
  scriptedViewers,
  scriptedGameEvents,
  onScriptedViewersChange,
  onScriptedGameEventsChange,
}: DirectorPanelProps) {
  const events = useMemo(() => eventsByLine(log), [log]);
  const status = snapshot ? STATUS_STYLES[snapshot.status] : null;
  const counters = snapshot?.counters;
  const counterItems: [string, number][] = [
    ["Lines spoken", counters?.linesSpoken ?? 0],
    ["Cancelled", counters?.linesCancelled ?? 0],
    ["Failed", counters?.linesFailed ?? 0],
    ["Ignored", counters?.eventsIgnored ?? 0],
    ["Cue leaks", counters?.cueLeaks ?? 0],
  ];
  const queue = snapshot?.queue ?? [];
  // Newest first, so the latest decision is in view without scrolling.
  const recent = log.entries
    .map((entry, i) => ({ entry, key: log.dropped + i }))
    .reverse();

  return (
    <section
      aria-label="Director"
      className="min-w-0 rounded-2xl bg-slate-950 text-slate-100 ring-1 ring-white/10 lg:col-start-1 lg:row-start-2"
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide">Director</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            status?.pill ?? TONES.neutral
          }`}
        >
          {status?.label ?? "Not started"}
        </span>
      </div>

      <div className="space-y-4 px-4 py-3 text-xs">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <Label>Current segment</Label>
            <div className="text-sm font-medium text-slate-100">
              {snapshot?.segmentIndex !== null &&
              snapshot?.segmentIndex !== undefined
                ? describeSegment(plan, snapshot.segmentIndex)
                : "None"}
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <Label>Line in flight</Label>
            <div className="break-words text-sm font-medium text-slate-100">
              {snapshot?.inFlight
                ? describeLine(snapshot.inFlight, events)
                : "None"}
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-t border-white/10 pt-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0 space-y-1.5">
            <Label>Queue ({queue.length})</Label>
            {queue.length === 0 ? (
              <p className="text-slate-500">Empty</p>
            ) : (
              <ol className="list-decimal space-y-1 pl-4 text-slate-200">
                {queue.map((line) => (
                  <li key={line.id} className="break-words">
                    {describeLine(line, events)}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label>Decision log, newest first</Label>
            {recent.length === 0 ? (
              <p className="text-slate-500">Nothing yet</p>
            ) : (
              <ol
                aria-label="Decision log"
                tabIndex={0}
                className={`max-h-64 space-y-1.5 overflow-y-auto rounded pr-1 ${DARK_FOCUS_RING}`}
              >
                {recent.map(({ entry, key }) => {
                  const view = describeEntry(entry, events, plan);
                  return (
                    <li key={key} className="flex gap-2">
                      <time className="shrink-0 tabular-nums text-slate-500">
                        {new Date(entry.at).toLocaleTimeString()}
                      </time>
                      <div className="min-w-0 break-words text-slate-200">
                        {view.tags.map((tag) => (
                          <span
                            key={tag.label}
                            className={`mr-1.5 inline-block rounded-full px-1.5 py-px text-[10px] font-medium ${TONES[tag.tone]}`}
                          >
                            {tag.label}
                          </span>
                        ))}
                        {view.text}
                        {view.failure !== undefined && (
                          <div className="text-red-300">
                            Failure: {view.failure}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        <dl className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-white/10 pt-3">
          {counterItems.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <dt className="text-slate-400">{label}</dt>
              <dd className="font-semibold tabular-nums text-slate-100">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-3">
          <Toggle
            label="Scripted viewers"
            checked={scriptedViewers}
            onChange={onScriptedViewersChange}
          />
          <Toggle
            label="Scripted game events"
            checked={scriptedGameEvents}
            onChange={onScriptedGameEventsChange}
          />
        </div>
      </div>
    </section>
  );
}
