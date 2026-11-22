import type {
  Decision,
  DirectorLogEntry,
  IgnoreReason,
  ShowEvent,
  SpeakResult,
} from "../../director";

export const SHOW_LOG_LIMIT = 200;

/** The Director's log for the current show, keeping only the latest entries. */
export interface ShowLog {
  entries: readonly DirectorLogEntry[];
  /**
   * How many earlier entries the cap has dropped. `dropped + i` stays the same
   * for an entry as older ones fall off, so it serves as a React key.
   */
  dropped: number;
}

export const EMPTY_SHOW_LOG: ShowLog = { entries: [], dropped: 0 };

export function appendToShowLog(
  log: ShowLog,
  added: readonly DirectorLogEntry[],
  limit = SHOW_LOG_LIMIT,
): ShowLog {
  const all = [...log.entries, ...added];
  const over = Math.max(0, all.length - limit);
  return { entries: all.slice(over), dropped: log.dropped + over };
}

const IGNORE_REASON_LABELS: Record<IgnoreReason, string> = {
  "show-not-running": "show not running",
  empty: "empty message",
  "viewer-cooldown": "viewer cooldown",
  "source-cooldown": "source cooldown",
  "queue-full": "queue full",
  "not-silent": "not silent",
  stale: "stale",
};

export function describeDecision(decision: Decision): string {
  if (decision.kind === "enqueue") return "Queued";
  if (decision.kind === "interrupt") return "Interrupting";
  return `Ignored: ${IGNORE_REASON_LABELS[decision.reason]}`;
}

export type TranscriptItem =
  | {
      kind: "viewer";
      key: string;
      viewer: string;
      text: string;
      highlighted: boolean;
      decision: Decision;
    }
  | {
      kind: "character";
      key: string;
      lineId: string;
      /**
       * `speaking` until the line's line-end arrives, or `failed` once the
       * show has failed, since a failed show may never settle the line.
       */
      status: "speaking" | SpeakResult["status"];
      text: string;
    };

/**
 * The chat as viewers see it: chat messages with the Director's decision, and
 * the character's lines. A line enters only at its line-start, so a line that
 * was dropped or cleared before it started never shows as spoken. Cues and
 * agent events are not chat and never appear here.
 */
export function buildTranscript(log: ShowLog): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const lineItems = new Map<string, number>();

  log.entries.forEach((entry, i) => {
    const key = String(log.dropped + i);
    if (entry.kind === "decision" && entry.event.kind === "chat") {
      items.push({
        kind: "viewer",
        key,
        viewer: entry.event.viewer,
        text: entry.event.text,
        highlighted: entry.event.highlighted === true,
        decision: entry.decision,
      });
    } else if (entry.kind === "line-start") {
      lineItems.set(entry.line.id, items.length);
      items.push({
        kind: "character",
        key,
        lineId: entry.line.id,
        status: "speaking",
        text: "",
      });
    } else if (entry.kind === "line-end") {
      // A line whose line-start the cap has dropped is left out whole.
      const index = lineItems.get(entry.line.id);
      if (index === undefined) return;
      const item = items[index];
      if (item.kind !== "character") return;
      items[index] = {
        ...item,
        status: entry.result.status,
        text: entry.result.text,
      };
    } else if (entry.kind === "error") {
      // An error entry ends the show as failed. A line-end that still comes
      // later overwrites this through the branch above.
      for (const [lineIndex, item] of items.entries()) {
        if (item.kind === "character" && item.status === "speaking") {
          items[lineIndex] = { ...item, status: "failed" };
        }
      }
    }
  });

  return items;
}

/** Each accepted line's id mapped to the event that created it. */
export function eventsByLine(log: ShowLog): Map<string, ShowEvent> {
  const events = new Map<string, ShowEvent>();
  for (const entry of log.entries) {
    if (entry.kind === "decision" && entry.decision.kind !== "ignore") {
      events.set(entry.decision.line.id, entry.event);
    }
  }
  return events;
}
