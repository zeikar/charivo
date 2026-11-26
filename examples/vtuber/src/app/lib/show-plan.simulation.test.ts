import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirector,
  createPushSource,
  type DirectorLogEntry,
  type DirectorStatus,
  type ExternalShowEvent,
  type ShowEventSource,
} from "../../director";
import {
  createFakePort,
  type FakePort,
  type FakePortOptions,
} from "../../director/fake-port";
import { DEFAULT_SHOW_PLAN, SHOW_DIRECTOR_CONFIG } from "./show-plan";

const TEN_MINUTES_MS = 600_000;

// Fake timers fire every timer at its due time, and the Director's promise
// hops run before the clock moves on, so a correct Director starts lines with
// no lag at all here. The slack is only headroom for an extra async hop (such
// as a setTimeout(0)) and stays far below anything a viewer would notice.
const SCHEDULING_SLACK_MS = 10;

// About 6 s of reply generation and Gemini synthesis before any audio, then
// 4-9 s of audio. The audio length varies by line, deterministically, so the
// segment boundaries land at different points in the line/idle cycle rather
// than at one repeating phase.
const GENERATION_MS = 6_000;
function realisticDurationMs(index: number): number {
  return GENERATION_MS + 4_000 + ((index * 2_300) % 5_000);
}

const { idleAfterMs, minLineIntervalMs, failedLineBackoffMs } =
  SHOW_DIRECTOR_CONFIG;

const ENDING_CUE =
  DEFAULT_SHOW_PLAN.segments[DEFAULT_SHOW_PLAN.segments.length - 1].cue;

function runShow(
  portOptions: FakePortOptions,
  sources: readonly ShowEventSource<ExternalShowEvent>[] = [],
) {
  const port = createFakePort(portOptions);
  const director = createDirector({
    port,
    plan: DEFAULT_SHOW_PLAN,
    config: SHOW_DIRECTOR_CONFIG,
    sources,
  });
  const log: DirectorLogEntry[] = [];
  const statuses: { at: number; status: DirectorStatus }[] = [];
  director.subscribe((snapshot, entries) => {
    log.push(...entries);
    statuses.push({ at: Date.now(), status: snapshot.status });
  });
  director.start();
  return { port, director, log, statuses };
}

function endingStarted(port: FakePort): boolean {
  return port.calls.some(
    (call) => call.input.kind === "direction" && call.input.text === ENDING_CUE,
  );
}

// The ending starts at the latest one line plus its pacing after ten minutes
// and settles within one more line, so a minute covers it with room to spare.
async function runToEnd(): Promise<void> {
  await vi.advanceTimersByTimeAsync(60_000);
}

// Steps through virtual time until `done()` holds, failing after `withinMs`.
const STEP_MS = 100;
async function advanceUntil(
  done: () => boolean,
  withinMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!done()) {
    if (Date.now() >= deadline) {
      throw new Error(`No ${what} within ${withinMs} ms`);
    }
    await vi.advanceTimersByTimeAsync(STEP_MS);
  }
}
// The longest line plus the idle wait after it, with room.
const NEXT_LINE_WITHIN_MS = 30_000;
// Cues and chat answers can come first, so allow several lines.
const IDLE_LINE_WITHIN_MS = 90_000;

// Show pacing only: the spacing between line starts. Nothing here counts or
// bounds provider requests. The floors bind in the instant and failing runs;
// realistic lines outlast the minimum interval, so there they hold with room.
function expectShowPacing(port: FakePort): void {
  expect(port.calls.length).toBeGreaterThan(1);
  for (let i = 1; i < port.calls.length; i++) {
    const previous = port.calls[i - 1];
    const gap = port.calls[i].startedAt - previous.startedAt;
    expect(gap, `gap before line ${i + 1}`).toBeGreaterThanOrEqual(
      minLineIntervalMs,
    );
    if (previous.result?.status === "failed") {
      expect(gap, `gap after failed line ${i}`).toBeGreaterThanOrEqual(
        failedLineBackoffMs,
      );
    }
  }
}

function expectSegmentsInOrder(log: DirectorLogEntry[], port: FakePort): void {
  const reached = log.flatMap((entry) =>
    entry.kind === "segment" ? [[entry.index, entry.segment.kind]] : [],
  );
  expect(reached).toEqual([
    [0, "opening"],
    [1, "topic"],
    [2, "topic"],
    [3, "topic"],
    [4, "ending"],
  ]);
  const cuesSpoken = log.flatMap((entry) =>
    entry.kind === "line-start" && entry.line.source === "segment"
      ? [entry.line.input]
      : [],
  );
  expect(cuesSpoken).toEqual(
    DEFAULT_SHOW_PLAN.segments.map((segment) => ({
      kind: "direction",
      text: segment.cue,
    })),
  );
  // Nothing is spoken after the goodbye.
  expect(port.calls[port.calls.length - 1].input).toEqual({
    kind: "direction",
    text: ENDING_CUE,
  });
}

function expectNoOverlap(port: FakePort): void {
  expect(port.peakUnsettled).toBe(1);
  for (let i = 1; i < port.calls.length; i++) {
    expect(port.calls[i].startedAt).toBeGreaterThanOrEqual(
      port.calls[i - 1].endedAt ?? Infinity,
    );
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DEFAULT_SHOW_PLAN", () => {
  it("gives the opening and topics at least ten minutes", () => {
    const total = DEFAULT_SHOW_PLAN.segments.reduce(
      (sum, segment) =>
        segment.kind === "ending" ? sum : sum + segment.durationMs,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(TEN_MINUTES_MS);
    expect(DEFAULT_SHOW_PLAN.segments.map((segment) => segment.kind)).toEqual([
      "opening",
      "topic",
      "topic",
      "topic",
      "ending",
    ]);
  });
});

describe("the default show in virtual time", () => {
  it("runs ten minutes of realistic lines, one at a time, to its ending", async () => {
    const { port, director, log } = runShow({
      durationMs: realisticDurationMs,
    });

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1);
    expect(director.getSnapshot().status).toBe("running");
    expect(endingStarted(port)).toBe(false);

    await runToEnd();
    expect(director.getSnapshot().status).toBe("finished");
    expect(vi.getTimerCount()).toBe(0);

    expect(port.peakUnsettled).toBe(1);
    expect(port.interruptCalls).toBe(0);
    expect(
      port.calls.every((call) => call.result?.status === "completed"),
    ).toBe(true);
    expectSegmentsInOrder(log, port);
    expectShowPacing(port);

    // The show never stalls: with no chat, the next line is either idle
    // filler once the idle wait after the last one has run out, or a cue
    // that arrived sooner, held back only by the minimum interval.
    for (let i = 1; i < port.calls.length; i++) {
      const previous = port.calls[i - 1];
      const latest =
        Math.max(
          (previous.endedAt ?? Infinity) + idleAfterMs,
          previous.startedAt + minLineIntervalMs,
        ) + SCHEDULING_SLACK_MS;
      expect(
        port.calls[i].startedAt,
        `start of line ${i + 1}`,
      ).toBeLessThanOrEqual(latest);
    }
  });

  it("does not reach the ending before ten minutes even when lines are instant", async () => {
    const { port, director } = runShow({ durationMs: 1 });

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1);
    expect(director.getSnapshot().status).toBe("running");
    expect(endingStarted(port)).toBe(false);

    await runToEnd();
    expect(director.getSnapshot().status).toBe("finished");
    expect(vi.getTimerCount()).toBe(0);
    expectShowPacing(port);
  });

  it("carries a show whose every line fails through to its ending", async () => {
    const { port, director, log, statuses } = runShow({
      durationMs: 500,
      respond: () => ({ status: "failed", text: "", error: "503" }),
    });

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1);
    expect(director.getSnapshot().status).toBe("running");
    expect(endingStarted(port)).toBe(false);

    await runToEnd();
    expect(director.getSnapshot().status).toBe("finished");
    expect(vi.getTimerCount()).toBe(0);

    // A show leaves `running` only once, so its first other status is its
    // only one: `finished`, never `failed`, and not before ten minutes.
    const showEnd = statuses.find(({ status }) => status !== "running");
    expect(showEnd).toEqual({ status: "finished", at: expect.any(Number) });
    expect(showEnd!.at).toBeGreaterThanOrEqual(TEN_MINUTES_MS);
    expect(port.calls.every((call) => call.result?.status === "failed")).toBe(
      true,
    );
    expect(port.interruptCalls).toBe(0);
    expectSegmentsInOrder(log, port);
    expectShowPacing(port);
  });

  it("answers chat and agent events in turn and lets one highlight cut idle filler", async () => {
    const chats = createPushSource();
    const agents = createPushSource();
    const { port, director, log } = runShow(
      { durationMs: realisticDurationMs },
      [chats, agents],
    );
    const chat = (viewer: string, text: string): ExternalShowEvent => ({
      kind: "chat",
      viewer,
      text,
    });
    const event = (source: string, text: string): ExternalShowEvent => ({
      kind: "agent",
      source,
      text,
      priority: "normal",
    });

    // Each step waits until `from`, then for the moment it names, and pushes
    // its inputs. Ordinary inputs go in 1 s after a line starts, so they land
    // mid-line however long lines are; the highlight waits for idle filler,
    // the only kind of line it may cut. No input is turned away: the burst
    // stays within maxPendingChat, a viewer speaks again only long after
    // viewerCooldownMs, an agent source repeats only after agentCooldownMs,
    // and each event is reached well inside agentMaxAgeMs.
    const script: {
      from: number;
      when: "mid-line" | "idle-line";
      events: ExternalShowEvent[];
    }[] = [
      {
        from: 20_000,
        when: "mid-line",
        events: [chat("mika", "hi! just got here")],
      },
      {
        from: 90_000,
        when: "mid-line",
        events: [
          chat("ren", "what did you eat today?"),
          chat("sora", "ramen or curry?"),
          chat("yui", "I made dumplings last night"),
          chat("kai", "any snack recommendations?"),
        ],
      },
      {
        from: 155_000,
        when: "mid-line",
        events: [event("weather", "It just started raining outside.")],
      },
      {
        from: 280_000,
        when: "idle-line",
        events: [
          {
            kind: "chat",
            viewer: "noa",
            text: "it's my birthday today!",
            highlighted: true,
          },
        ],
      },
      {
        from: 350_000,
        when: "mid-line",
        events: [event("pet-cam", "The cat jumped onto the desk.")],
      },
      {
        from: 425_000,
        when: "mid-line",
        events: [chat("mika", "what game is that?")],
      },
      {
        from: 500_000,
        when: "mid-line",
        events: [event("weather", "The rain stopped and the sun is out.")],
      },
    ];
    for (const step of script) {
      await vi.advanceTimersByTimeAsync(Math.max(0, step.from - Date.now()));
      if (step.when === "mid-line") {
        const seen = port.calls.length;
        await advanceUntil(
          () => port.calls.length > seen,
          NEXT_LINE_WITHIN_MS,
          `a line start after ${step.from} ms`,
        );
        await vi.advanceTimersByTimeAsync(
          port.calls[seen].startedAt + 1_000 - Date.now(),
        );
      } else {
        await advanceUntil(
          () => director.getSnapshot().inFlight?.source === "idle",
          IDLE_LINE_WITHIN_MS,
          `idle filler in flight after ${step.from} ms`,
        );
      }
      for (const input of step.events) {
        (input.kind === "chat" ? chats : agents).push(input);
      }
    }
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1 - Date.now());
    expect(director.getSnapshot().status).toBe("running");
    expect(endingStarted(port)).toBe(false);
    await runToEnd();
    expect(director.getSnapshot().status).toBe("finished");
    expect(vi.getTimerCount()).toBe(0);

    const inputs = log.flatMap((entry, index) =>
      entry.kind === "decision" &&
      (entry.event.kind === "chat" || entry.event.kind === "agent")
        ? [
            {
              index,
              kind: entry.decision.kind,
              lineId:
                entry.decision.kind === "ignore"
                  ? null
                  : entry.decision.line.id,
            },
          ]
        : [],
    );
    expect(inputs.map(({ kind }) => kind)).toEqual(
      script.flatMap((step) =>
        step.events.map((input) =>
          input.kind === "chat" && input.highlighted ? "interrupt" : "enqueue",
        ),
      ),
    );

    const startIndex = (id: string) =>
      log.findIndex((e) => e.kind === "line-start" && e.line.id === id);
    const endIndex = (id: string) =>
      log.findIndex((e) => e.kind === "line-end" && e.line.id === id);
    const endStatus = (id: string) => {
      const entry = log[endIndex(id)];
      return entry?.kind === "line-end" ? entry.result.status : null;
    };
    const inFlightAt = (index: number) => {
      let id: string | null = null;
      for (const entry of log.slice(0, index)) {
        if (entry.kind === "line-start") id = entry.line.id;
        if (entry.kind === "line-end" && entry.line.id === id) id = null;
      }
      return id;
    };

    // An ordinary input waits for the line that was playing when it came
    // in; that line plays to its end, and only then is the input answered.
    for (const { index, kind, lineId } of inputs) {
      if (kind !== "enqueue") continue;
      const playing = inFlightAt(index);
      expect(playing, `line playing at ${lineId}`).not.toBeNull();
      expect(endStatus(playing!)).toBe("completed");
      expect(startIndex(lineId!)).toBeGreaterThan(endIndex(playing!));
      expect(endStatus(lineId!)).toBe("completed");
    }

    // The highlight cut the filler it landed on, and nothing else was cut.
    expect(port.interruptCalls).toBe(1);
    const highlight = inputs.find(({ kind }) => kind === "interrupt")!;
    const cut = inFlightAt(highlight.index)!;
    expect(endStatus(cut)).toBe("cancelled");
    expect(endStatus(highlight.lineId!)).toBe("completed");
    expect(
      port.calls.filter((call) => call.result?.status === "cancelled"),
    ).toHaveLength(1);

    expectNoOverlap(port);
    expectSegmentsInOrder(log, port);
    expectShowPacing(port);
  });
});
