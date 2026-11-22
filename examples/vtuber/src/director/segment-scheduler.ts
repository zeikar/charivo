import type { Segment, SegmentEvent, ShowEventSource, ShowPlan } from "./types";

/**
 * Emits `segment` for each of `plan.segments` in order: the first at start(),
 * each later one once the durations of the segments before it have elapsed.
 */
export interface SegmentScheduler extends ShowEventSource<SegmentEvent> {
  /** The segment most recently reached, or null before the first. */
  current(): { index: number; segment: Segment } | null;
}

export function createSegmentScheduler(plan: ShowPlan): SegmentScheduler {
  let emit: ((event: SegmentEvent) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: SegmentEvent | null = null;

  function enter(index: number): void {
    const segment = plan.segments[index];
    if (emit === null || segment === undefined) return;
    current = { kind: "segment", index, segment };
    // Scheduled before emitting, so a stop() from inside emit cancels it.
    if (segment.kind !== "ending") {
      timer = setTimeout(() => {
        timer = null;
        enter(index + 1);
      }, segment.durationMs);
    }
    emit(current);
  }

  return {
    start(next) {
      emit = next;
      enter(0);
    },
    stop() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      emit = null;
    },
    current() {
      return current && { index: current.index, segment: current.segment };
    },
  };
}
