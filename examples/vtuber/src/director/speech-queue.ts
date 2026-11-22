import type { Line, LineSource } from "./types";

export interface ShiftResult {
  /** The next line to speak, or null when nothing fresh is left. */
  line: Line | null;
  /** Expired lines skipped on the way, oldest first. */
  dropped: Line[];
}

export interface SpeechQueue {
  push(line: Line): void;
  shift(now: number): ShiftResult;
  /** Removes and returns every line matching `predicate`. */
  removeWhere(predicate: (line: Line) => boolean): Line[];
  /**
   * Lines still fresh at `now`, per source. Expired lines are left out: shift
   * would drop them, so they must not count against a queue cap.
   */
  pendingCounts(now: number): Record<LineSource, number>;
  /** The waiting lines in the order they would be spoken. */
  snapshot(): Line[];
}

// One rule for shift and pendingCounts: a line is fresh through its expiry.
function isExpired(line: Line, now: number): boolean {
  return line.expiresAt !== undefined && line.expiresAt < now;
}

export function createSpeechQueue(): SpeechQueue {
  // Kept in speaking order, so shift and snapshot need no sort.
  let lines: Line[] = [];

  return {
    push(line) {
      // After every line of equal or higher priority: FIFO within a priority.
      const at = lines.findIndex((queued) => queued.priority < line.priority);
      if (at === -1) {
        lines.push(line);
      } else {
        lines.splice(at, 0, line);
      }
    },

    shift(now) {
      const dropped: Line[] = [];
      let next = lines.shift();
      // Staleness is judged here, at dequeue, not when the line was accepted.
      while (next && isExpired(next, now)) {
        dropped.push(next);
        next = lines.shift();
      }
      return { line: next ?? null, dropped };
    },

    removeWhere(predicate) {
      const kept: Line[] = [];
      const removed: Line[] = [];
      for (const line of lines) (predicate(line) ? removed : kept).push(line);
      lines = kept;
      return removed;
    },

    pendingCounts(now) {
      const counts = { chat: 0, agent: 0, idle: 0, segment: 0 };
      for (const line of lines) {
        if (!isExpired(line, now)) counts[line.source]++;
      }
      return counts;
    },

    snapshot() {
      return [...lines];
    },
  };
}
