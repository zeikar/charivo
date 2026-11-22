import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSegmentScheduler } from "./segment-scheduler";
import type { SegmentEvent, ShowPlan } from "./types";

const plan: ShowPlan = {
  segments: [
    { kind: "opening", title: "Hello", cue: "Open.", durationMs: 1_000 },
    { kind: "topic", title: "Games", cue: "Talk games.", durationMs: 3_000 },
    { kind: "ending", title: "Goodbye", cue: "Say goodbye." },
  ],
};

function titles(events: SegmentEvent[]): string[] {
  return events.map((event) => `${event.index}:${event.segment.title}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSegmentScheduler", () => {
  it("emits the first segment at start(), each later one after the durations before it, in order", () => {
    const scheduler = createSegmentScheduler(plan);
    const emitted: SegmentEvent[] = [];
    expect(scheduler.current()).toBeNull();

    scheduler.start((event) => emitted.push(event));
    expect(titles(emitted)).toEqual(["0:Hello"]);
    expect(emitted[0]).toEqual({
      kind: "segment",
      index: 0,
      segment: plan.segments[0],
    });

    vi.advanceTimersByTime(999);
    expect(emitted).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(titles(emitted)).toEqual(["0:Hello", "1:Games"]);

    vi.advanceTimersByTime(2_999);
    expect(emitted).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(titles(emitted)).toEqual(["0:Hello", "1:Games", "2:Goodbye"]);
  });

  it("schedules nothing after the ending segment", () => {
    const scheduler = createSegmentScheduler({
      segments: [
        { kind: "ending", title: "Goodbye", cue: "Say goodbye." },
        { kind: "topic", title: "Never", cue: "Unreachable.", durationMs: 1 },
      ],
    });
    const emitted: SegmentEvent[] = [];

    scheduler.start((event) => emitted.push(event));

    expect(titles(emitted)).toEqual(["0:Goodbye"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports the current segment", () => {
    const scheduler = createSegmentScheduler(plan);
    scheduler.start(() => {});
    expect(scheduler.current()).toEqual({
      index: 0,
      segment: plan.segments[0],
    });

    vi.advanceTimersByTime(1_000);
    expect(scheduler.current()).toEqual({
      index: 1,
      segment: plan.segments[1],
    });
  });

  it("is already current when its event is emitted", () => {
    const scheduler = createSegmentScheduler(plan);
    const seen: (number | undefined)[] = [];
    scheduler.start(() => seen.push(scheduler.current()?.index));
    vi.advanceTimersByTime(1_000);
    expect(seen).toEqual([0, 1]);
  });

  it("cancels the remaining segments on stop()", () => {
    const scheduler = createSegmentScheduler(plan);
    const emitted: SegmentEvent[] = [];
    scheduler.start((event) => emitted.push(event));

    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(titles(emitted)).toEqual(["0:Hello"]);
  });

  it("emits nothing more when stopped from inside its own emit", () => {
    const scheduler = createSegmentScheduler(plan);
    const emitted: SegmentEvent[] = [];
    scheduler.start((event) => {
      emitted.push(event);
      scheduler.stop();
    });

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(titles(emitted)).toEqual(["0:Hello"]);
  });

  it("emits nothing for an empty plan", () => {
    const scheduler = createSegmentScheduler({ segments: [] });
    const emitted: SegmentEvent[] = [];
    scheduler.start((event) => emitted.push(event));
    expect(emitted).toEqual([]);
    expect(scheduler.current()).toBeNull();
  });
});
