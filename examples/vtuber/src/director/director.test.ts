import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirector,
  type DirectorListener,
  type DirectorOptions,
} from "./director";
import { createFakePort, type FakePortOptions } from "./fake-port";
import { createIdleTimer } from "./idle-timer";
import { createPushSource } from "./push-source";
import {
  DEFAULT_DIRECTOR_CONFIG,
  type CharacterPort,
  type DirectorConfig,
  type DirectorLogEntry,
  type ExternalShowEvent,
  type ShowEvent,
  type ShowEventSource,
  type ShowPlan,
} from "./types";

// The Director creates its idle timer and scheduler itself; these wrappers
// keep each instance so a test can count its stop() calls.
const internal = vi.hoisted(() => ({
  idleTimers: [] as { stop: () => void }[],
  schedulers: [] as { stop: () => void }[],
}));

vi.mock("./idle-timer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idle-timer")>();
  return {
    ...actual,
    createIdleTimer: (idleAfterMs: number) => {
      const timer = actual.createIdleTimer(idleAfterMs);
      vi.spyOn(timer, "stop");
      internal.idleTimers.push(timer);
      return timer;
    },
  };
});

vi.mock("./segment-scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./segment-scheduler")>();
  return {
    ...actual,
    createSegmentScheduler: (showPlan: ShowPlan) => {
      const scheduler = actual.createSegmentScheduler(showPlan);
      vi.spyOn(scheduler, "stop");
      internal.schedulers.push(scheduler);
      return scheduler;
    },
  };
});

const IDLE_PROMPT =
  "[DIRECTOR] Chat is quiet. Keep the stream going with one short new thought.";

// No segments, so these tests see the loop without any segment cue.
const plan: ShowPlan = { segments: [] };

const showPlan: ShowPlan = {
  segments: [
    { kind: "opening", title: "Hello", cue: "Open.", durationMs: 10_000 },
    { kind: "topic", title: "Games", cue: "Talk games.", durationMs: 20_000 },
    { kind: "ending", title: "Goodbye", cue: "Say goodbye." },
  ],
};

const baseConfig: DirectorConfig = {
  ...DEFAULT_DIRECTOR_CONFIG,
  idleAfterMs: 5_000,
  minLineIntervalMs: 0,
  failedLineBackoffMs: 0,
};

function setup(
  options: {
    port?: FakePortOptions;
    config?: Partial<DirectorConfig>;
    sources?: DirectorOptions["sources"];
    plan?: ShowPlan;
  } = {},
) {
  const port = createFakePort(options.port);
  const chat = createPushSource();
  const agents = createPushSource();
  const director = createDirector({
    port,
    plan: options.plan ?? plan,
    config: { ...baseConfig, ...options.config },
    sources: options.sources ?? [chat, agents],
  });
  const log: DirectorLogEntry[] = [];
  director.subscribe((_snapshot, entries) => log.push(...entries));
  return { port, chat, agents, director, log };
}

function say(viewer: string, text = `hi from ${viewer}`): ExternalShowEvent {
  return { kind: "chat", viewer, text };
}

function prompts(port: { calls: readonly { prompt: string }[] }): string[] {
  return port.calls.map((call) => call.prompt);
}

function starts(port: { calls: readonly { startedAt: number }[] }): number[] {
  return port.calls.map((call) => call.startedAt);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPushSource", () => {
  it("emits only while started", () => {
    const source = createPushSource();
    const emitted: ShowEvent[] = [];

    source.push(say("early"));
    source.start((event) => emitted.push(event));
    source.push(say("mika"));
    source.stop();
    source.push(say("late"));

    expect(emitted).toEqual([say("mika")]);
  });

  it("accepts no internal event kind", () => {
    const source = createPushSource();
    // @ts-expect-error idle is emitted only by the Director's own idle timer
    source.push({ kind: "idle" });
  });
});

describe("createDirector: one line at a time", () => {
  it("starts every source with its dispatch on start(), not before", () => {
    let emit: ((event: ExternalShowEvent) => void) | null = null;
    let startCount = 0;
    const recording: ShowEventSource<ExternalShowEvent> = {
      start: (next) => {
        startCount++;
        emit = next;
      },
      stop: () => {},
    };
    const { director, port, log } = setup({ sources: [recording] });
    expect(startCount).toBe(0);
    expect(director.getSnapshot().status).toBe("ready");

    director.start();
    director.start();

    expect(startCount).toBe(1);
    expect(director.getSnapshot().status).toBe("running");
    emit!(say("mika"));
    expect(log.map((entry) => entry.kind)).toEqual(["decision", "line-start"]);
    expect(prompts(port)).toEqual(["[CHAT] mika: hi from mika"]);
  });

  it("handles a source that emits synchronously inside its own start()", async () => {
    const eager: ShowEventSource<ExternalShowEvent> = {
      start: (emit) => emit(say("mika")),
      stop: () => {},
    };
    const { director, port, log } = setup({
      port: { durationMs: 1_000 },
      sources: [eager],
    });

    director.start();

    expect(prompts(port)).toEqual(["[CHAT] mika: hi from mika"]);
    expect(director.getSnapshot()).toMatchObject({
      status: "running",
      inFlight: { prompt: "[CHAT] mika: hi from mika" },
    });
    expect(log.filter((entry) => entry.kind === "line-start")).toHaveLength(1);

    // Nothing was left half-started: the idle timer follows the line as usual.
    await vi.advanceTimersByTimeAsync(1_000 + 5_000);
    expect(prompts(port)).toEqual(["[CHAT] mika: hi from mika", IDLE_PROMPT]);
    expect(starts(port)).toEqual([0, 6_000]);
    expect(port.peakUnsettled).toBe(1);
  });

  it("works without any source passed in", () => {
    const director = createDirector({
      port: createFakePort(),
      plan,
      config: baseConfig,
    });
    director.start();
    expect(director.getSnapshot().status).toBe("running");
  });

  it("turns a pushed event into a line", () => {
    const { director, chat, port } = setup();
    director.start();

    chat.push(say("mika", "hello!"));

    expect(prompts(port)).toEqual(["[CHAT] mika: hello!"]);
    expect(director.getSnapshot().inFlight?.prompt).toBe("[CHAT] mika: hello!");
  });

  it("starts a line only when no speak() is unsettled, then serves the queue by priority", async () => {
    const { director, chat, agents, port } = setup({
      port: { durationMs: 3_000 },
    });
    director.start();

    chat.push(say("first"));
    agents.push({
      kind: "agent",
      source: "game",
      text: "ambient",
      priority: "low",
    });
    chat.push(say("second"));
    agents.push({
      kind: "agent",
      source: "radio",
      text: "breaking",
      priority: "high",
    });

    expect(port.calls).toHaveLength(1);
    expect(director.getSnapshot().queue.map((line) => line.prompt)).toEqual([
      "[EVENT] radio: breaking",
      "[CHAT] second: hi from second",
      "[EVENT] game: ambient",
    ]);

    await vi.advanceTimersByTimeAsync(12_000);

    expect(prompts(port)).toEqual([
      "[CHAT] first: hi from first",
      "[EVENT] radio: breaking",
      "[CHAT] second: hi from second",
      "[EVENT] game: ambient",
    ]);
    expect(starts(port)).toEqual([0, 3_000, 6_000, 9_000]);
    expect(port.peakUnsettled).toBe(1);
    expect(port.interruptCalls).toBe(0);
  });

  it("keeps inFlight accurate and hands out snapshots the caller cannot change", async () => {
    const { director, chat } = setup({ port: { durationMs: 1_000 } });
    const seen: unknown[] = [];
    const unsubscribe = director.subscribe((snapshot) => seen.push(snapshot));
    director.start();
    chat.push(say("mika"));

    const during = director.getSnapshot();
    expect(during.inFlight?.source).toBe("chat");
    expect(Object.isFrozen(during)).toBe(true);
    expect(Object.isFrozen(during.queue)).toBe(true);
    expect(Object.isFrozen(during.counters)).toBe(true);
    expect(Object.isFrozen(during.inFlight)).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(director.getSnapshot().inFlight).toBeNull();
    expect(director.getSnapshot().counters.linesSpoken).toBe(1);

    const count = seen.length;
    unsubscribe();
    chat.push(say("rin"));
    expect(seen).toHaveLength(count);
  });
});

describe("createIdleTimer", () => {
  it("emits idle once, idleAfterMs after arm()", () => {
    const timer = createIdleTimer(1_000);
    const emitted: ShowEvent[] = [];
    timer.start((event) => emitted.push(event));

    timer.arm();
    vi.advanceTimersByTime(999);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([{ kind: "idle" }]);
    vi.advanceTimersByTime(10_000);
    expect(emitted).toHaveLength(1);
  });

  it("restarts the wait when armed again, and emits nothing after cancel()", () => {
    const timer = createIdleTimer(1_000);
    const emitted: ShowEvent[] = [];
    timer.start((event) => emitted.push(event));

    timer.arm();
    vi.advanceTimersByTime(600);
    timer.arm();
    vi.advanceTimersByTime(600);
    expect(emitted).toEqual([]);
    timer.cancel();
    vi.advanceTimersByTime(10_000);
    expect(emitted).toEqual([]);
  });

  it("clears its timer on stop() and stays silent afterwards", () => {
    const timer = createIdleTimer(1_000);
    const emitted: ShowEvent[] = [];
    timer.start((event) => emitted.push(event));

    timer.arm();
    timer.stop();
    expect(vi.getTimerCount()).toBe(0);
    timer.arm();
    vi.advanceTimersByTime(10_000);
    expect(emitted).toEqual([]);
  });
});

describe("createDirector: idle speech", () => {
  it("speaks exactly one idle line after idleAfterMs of silence", async () => {
    const { director, port } = setup({ port: { durationMs: 2_000 } });
    director.start();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(port.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts(port)).toEqual([IDLE_PROMPT]);
    expect(director.getSnapshot().inFlight?.source).toBe("idle");

    // The line plays 2 s, then another 5 s of silence before the next one.
    await vi.advanceTimersByTimeAsync(6_999);
    expect(port.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts(port)).toEqual([5_000, 12_000]);
  });

  it("starts no idle line while a line is in flight", async () => {
    const { director, chat, port } = setup({ port: { durationMs: 20_000 } });
    director.start();
    chat.push(say("mika"));

    await vi.advanceTimersByTimeAsync(20_000 + 4_999);
    expect(port.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts(port)).toEqual(["[CHAT] mika: hi from mika", IDLE_PROMPT]);
    expect(starts(port)).toEqual([0, 25_000]);
    expect(port.peakUnsettled).toBe(1);
  });
});

describe("createDirector: chat ordering (criterion 2)", () => {
  it.each([
    {
      name: "a chat",
      input: say("mika", "what game is this?"),
      prompt: "[CHAT] mika: what game is this?",
    },
    {
      name: "a normal agent event from a second source",
      input: {
        kind: "agent",
        source: "game",
        text: "Found diamonds.",
        priority: "normal",
      } satisfies ExternalShowEvent,
      prompt: "[EVENT] game: Found diamonds.",
    },
  ])(
    "speaks $name emitted mid-utterance after the current line, before idle filler, without interrupting it",
    async ({ input, prompt }) => {
      const { director, chat, agents, port } = setup({
        port: { durationMs: 4_000 },
      });
      director.start();

      // Idle filler starts at 5 s and plays until 9 s.
      await vi.advanceTimersByTimeAsync(6_000);
      expect(director.getSnapshot().inFlight?.source).toBe("idle");
      (input.kind === "chat" ? chat : agents).push(input);

      expect(port.calls).toHaveLength(1);
      expect(director.getSnapshot().queue.map((line) => line.prompt)).toEqual([
        prompt,
      ]);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(prompts(port)).toEqual([IDLE_PROMPT, prompt]);
      expect(starts(port)).toEqual([5_000, 9_000]);
      expect(port.calls[0].result?.status).toBe("completed");
      expect(port.interruptCalls).toBe(0);

      // The next filler waits for idleAfterMs of silence after the answer.
      await vi.advanceTimersByTimeAsync(4_000 + 5_000);
      expect(prompts(port)).toEqual([IDLE_PROMPT, prompt, IDLE_PROMPT]);
      expect(port.peakUnsettled).toBe(1);
    },
  );
});

describe("createDirector: log", () => {
  it("logs every decision, line start and line end, and counts ignored events", async () => {
    const { director, chat, port, log } = setup({
      port: { durationMs: 1_000 },
    });
    director.start();

    chat.push(say("mika", "hello!"));
    chat.push(say("rin", "   "));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(port.calls).toHaveLength(1);
    expect(director.getSnapshot().counters.eventsIgnored).toBe(1);
    expect(log).toEqual([
      {
        kind: "decision",
        at: 0,
        event: say("mika", "hello!"),
        decision: {
          kind: "enqueue",
          line: expect.objectContaining({
            id: "line-1",
            prompt: "[CHAT] mika: hello!",
          }),
        },
      },
      {
        kind: "line-start",
        at: 0,
        line: expect.objectContaining({ id: "line-1" }),
      },
      {
        kind: "decision",
        at: 0,
        event: say("rin", "   "),
        decision: { kind: "ignore", reason: "empty" },
      },
      {
        kind: "line-end",
        at: 1_000,
        line: expect.objectContaining({ id: "line-1" }),
        result: { status: "completed", text: "Reply 1." },
        leak: false,
      },
    ]);
  });

  it("allocates a new line id only when a line is created", () => {
    const { director, chat, log } = setup({ port: { durationMs: 1_000 } });
    director.start();

    chat.push(say("mika"));
    chat.push(say("mika")); // viewer cooldown: ignored
    chat.push(say("rin"));

    const ids = log.flatMap((entry) =>
      entry.kind === "decision" && entry.decision.kind !== "ignore"
        ? [entry.decision.line.id]
        : [],
    );
    expect(ids).toEqual(["line-1", "line-2"]);
  });

  it("drops a stale agent event at dequeue and logs it as stale", async () => {
    const { director, chat, agents, port, log } = setup({
      port: { durationMs: 20_000 },
      config: { agentMaxAgeMs: 10_000 },
    });
    director.start();

    chat.push(say("mika"));
    agents.push({
      kind: "agent",
      source: "game",
      text: "Found diamonds.",
      priority: "normal",
    });
    chat.push(say("rin"));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(prompts(port)).toEqual([
      "[CHAT] mika: hi from mika",
      "[CHAT] rin: hi from rin",
    ]);
    expect(log).toContainEqual({
      kind: "line-dropped",
      at: 20_000,
      line: expect.objectContaining({
        prompt: "[EVENT] game: Found diamonds.",
      }),
      reason: "stale",
    });
  });

  it("arms the idle timer once a drain drops the only queued line as stale", async () => {
    const { director, chat, agents, port } = setup({
      port: { durationMs: 20_000 },
      config: { agentMaxAgeMs: 10_000 },
    });
    director.start();

    chat.push(say("mika"));
    agents.push({
      kind: "agent",
      source: "game",
      text: "Found diamonds.",
      priority: "normal",
    });
    await vi.advanceTimersByTimeAsync(19_999);
    // Expired, but still queued when the line settles.
    expect(director.getSnapshot().queue).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(director.getSnapshot().queue).toHaveLength(0);
    expect(director.getSnapshot().inFlight).toBeNull();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(port.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts(port)).toEqual(["[CHAT] mika: hi from mika", IDLE_PROMPT]);
    expect(starts(port)).toEqual([0, 25_000]);
  });

  it("sets leak from findCueLeak on every reply, a chat answer included", async () => {
    const { director, chat, port, log } = setup({
      port: {
        durationMs: 1_000,
        respond: (call) => ({
          status: "completed",
          text:
            call.index === 0
              ? "My director told me to say hi!"
              : "Hi, nice to see you.",
        }),
      },
    });
    director.start();

    chat.push(say("mika"));
    chat.push(say("rin"));
    await vi.advanceTimersByTimeAsync(2_000);

    const ends = log.filter((entry) => entry.kind === "line-end");
    expect(ends.map((entry) => [entry.line.source, entry.leak])).toEqual([
      ["chat", true],
      ["chat", false],
    ]);
    expect(port.calls).toHaveLength(2);
    expect(director.getSnapshot().counters.cueLeaks).toBe(1);
  });
});

describe("createDirector: minimum interval", () => {
  it("starts queued lines exactly minLineIntervalMs apart when lines settle almost instantly", async () => {
    const { director, chat, port } = setup({
      port: { durationMs: 10 },
      config: { minLineIntervalMs: 7_000 },
    });
    director.start();

    chat.push(say("a"));
    chat.push(say("b"));
    chat.push(say("c"));
    await vi.advanceTimersByTimeAsync(13_999);
    expect(starts(port)).toEqual([0, 7_000]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts(port)).toEqual([0, 7_000, 14_000]);
    expect(port.peakUnsettled).toBe(1);
  });

  it("follows a line that outlasted the interval without extra delay", async () => {
    const { director, chat, port } = setup({
      port: { durationMs: 9_000 },
      config: { minLineIntervalMs: 7_000 },
    });
    director.start();

    chat.push(say("a"));
    chat.push(say("b"));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(starts(port)).toEqual([0, 9_000]);
  });

  it("holds an idle line to the interval too", async () => {
    const { director, chat, port } = setup({
      port: { durationMs: 10 },
      config: { minLineIntervalMs: 7_000, idleAfterMs: 1_000 },
    });
    director.start();

    chat.push(say("a"));
    // Idle fires at 1,010 ms, but the line may not start before 7,000 ms.
    await vi.advanceTimersByTimeAsync(6_999);
    expect(port.calls).toHaveLength(1);
    expect(director.getSnapshot().queue.map((line) => line.source)).toEqual([
      "idle",
    ]);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts(port)).toEqual(["[CHAT] a: hi from a", IDLE_PROMPT]);
    expect(starts(port)).toEqual([0, 7_000]);
  });

  it("keeps at most one pending start timer and serves the queue by priority when it fires", async () => {
    const { director, chat, agents, port } = setup({
      port: { durationMs: 10 },
      config: { minLineIntervalMs: 7_000 },
    });
    director.start();

    chat.push(say("a"));
    await vi.advanceTimersByTimeAsync(10);
    agents.push({
      kind: "agent",
      source: "game",
      text: "low",
      priority: "low",
    });
    chat.push(say("b"));

    await vi.advanceTimersByTimeAsync(6_989);
    expect(port.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts(port).slice(1)).toEqual(["[CHAT] b: hi from b"]);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(prompts(port).slice(1)).toEqual([
      "[CHAT] b: hi from b",
      "[EVENT] game: low",
    ]);
    expect(starts(port)).toEqual([0, 7_000, 14_000]);
  });

  it("does not let the idle timer fire while a start is held for pacing", async () => {
    const { director, chat, port, log } = setup({
      port: { durationMs: 10 },
      config: { minLineIntervalMs: 7_000, idleAfterMs: 1_000 },
    });
    director.start();

    chat.push(say("a"));
    await vi.advanceTimersByTimeAsync(500);
    // Idle was armed at 10 ms and would fire at 1,010 ms, inside the wait.
    chat.push(say("b"));
    await vi.advanceTimersByTimeAsync(6_500);

    expect(starts(port)).toEqual([0, 7_000]);
    expect(
      log.some(
        (entry) => entry.kind === "decision" && entry.event.kind === "idle",
      ),
    ).toBe(false);
    expect(director.getSnapshot().counters.eventsIgnored).toBe(0);

    // Re-armed after b settles, by the usual after-drain rule.
    await vi.advanceTimersByTimeAsync(10 + 1_000);
    expect(prompts(port)).toEqual([
      "[CHAT] a: hi from a",
      "[CHAT] b: hi from b",
    ]);
    await vi.advanceTimersByTimeAsync(7_000 - 1_010);
    expect(prompts(port).at(-1)).toBe(IDLE_PROMPT);
    expect(starts(port)).toEqual([0, 7_000, 14_000]);
  });
});

describe("createDirector: failed lines", () => {
  it.each([
    { name: "with the port's message", error: "HTTP 429" },
    { name: "with none when the port gave none", error: undefined },
  ])(
    "logs a failed line $name, counts it, keeps running, does not retry, and arms the idle timer",
    async ({ error }) => {
      const { director, chat, port, log } = setup({
        port: {
          durationMs: 1_000,
          respond: (call) =>
            call.index === 0
              ? error === undefined
                ? { status: "failed", text: "" }
                : { status: "failed", text: "", error }
              : { status: "completed", text: "Back again." },
        },
      });
      director.start();

      chat.push(say("mika"));
      await vi.advanceTimersByTimeAsync(1_000);

      const end = log.find((entry) => entry.kind === "line-end");
      expect(end).toMatchObject({
        kind: "line-end",
        at: 1_000,
        leak: false,
        result: { status: "failed", text: "", ...(error && { error }) },
      });
      if (error === undefined) expect(end).not.toHaveProperty("result.error");
      const snapshot = director.getSnapshot();
      expect(snapshot.status).toBe("running");
      expect(snapshot.error).toBeNull();
      expect(snapshot.counters).toMatchObject({
        linesSpoken: 0,
        linesFailed: 1,
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(port.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(prompts(port)).toEqual(["[CHAT] mika: hi from mika", IDLE_PROMPT]);
      expect(starts(port)).toEqual([0, 6_000]);
    },
  );
});

describe("createDirector: backoff after a failed line", () => {
  const pacing = { minLineIntervalMs: 2_000, failedLineBackoffMs: 6_000 };
  const firstFails: FakePortOptions = {
    durationMs: 10,
    respond: (call) =>
      call.index === 0
        ? { status: "failed", text: "", error: "HTTP 503" }
        : { status: "completed", text: `Reply ${call.index + 1}.` },
  };

  it("starts queued chat failedLineBackoffMs after the failed line started, then returns to the minimum interval", async () => {
    const { director, chat, port } = setup({
      port: firstFails,
      config: pacing,
    });
    director.start();

    chat.push(say("a"));
    await vi.advanceTimersByTimeAsync(5);
    chat.push(say("b"));
    chat.push(say("c"));

    await vi.advanceTimersByTimeAsync(5_994);
    expect(port.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts(port)).toEqual([0, 6_000]);

    // b completed, so c follows at the minimum interval.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(starts(port)).toEqual([0, 6_000, 8_000]);
  });

  it("holds idle filler to the backoff too", async () => {
    const { director, chat, port } = setup({
      port: firstFails,
      config: { ...pacing, idleAfterMs: 1_000 },
    });
    director.start();

    chat.push(say("a"));
    await vi.advanceTimersByTimeAsync(5_999);
    expect(port.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts(port)).toEqual(["[CHAT] a: hi from a", IDLE_PROMPT]);
    expect(starts(port)).toEqual([0, 6_000]);
  });

  it("keeps speak() calls failedLineBackoffMs apart while every line fails instantly", async () => {
    const { director, chat, port } = setup({
      port: {
        durationMs: 10,
        respond: () => ({ status: "failed", text: "", error: "HTTP 429" }),
      },
      config: { ...pacing, idleAfterMs: 100 },
    });
    director.start();

    chat.push(say("a"));
    chat.push(say("b"));
    chat.push(say("c"));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(port.calls.map((call) => call.prompt.slice(0, 10))).toEqual([
      "[CHAT] a: ",
      "[CHAT] b: ",
      "[CHAT] c: ",
      "[DIRECTOR]",
      "[DIRECTOR]",
      "[DIRECTOR]",
    ]);
    expect(starts(port)).toEqual([0, 6_000, 12_000, 18_000, 24_000, 30_000]);
    expect(director.getSnapshot().status).toBe("running");
    expect(director.getSnapshot().counters.linesFailed).toBe(5);
  });
});

describe("createDirector: a port whose speak() rejects or throws", () => {
  it.each([
    {
      name: "a rejection with an Error",
      throws: false,
      reason: new Error("network down"),
      error: "network down",
    },
    {
      name: "a rejection with a non-Error value",
      throws: false,
      reason: "socket closed",
      error: "socket closed",
    },
    {
      name: "a synchronous throw",
      throws: true,
      reason: new Error("port not ready"),
      error: "port not ready",
    },
  ])(
    "treats $name as a failed line carrying its message and carries on",
    async ({ throws, reason, error }) => {
      const calls: string[] = [];
      const port: CharacterPort = {
        speak: (prompt) => {
          calls.push(prompt);
          if (calls.length > 1) {
            return Promise.resolve({
              status: "completed",
              text: "Back again.",
            });
          }
          if (throws) throw reason;
          return Promise.reject(reason);
        },
        interrupt: () => Promise.resolve(),
      };
      const chat = createPushSource();
      const director = createDirector({
        port,
        plan,
        config: baseConfig,
        sources: [chat],
      });
      const log: DirectorLogEntry[] = [];
      director.subscribe((_snapshot, entries) => log.push(...entries));
      director.start();

      // Whatever the port does, nothing escapes to the caller of push().
      expect(() => chat.push(say("mika"))).not.toThrow();
      chat.push(say("rin"));
      await vi.advanceTimersByTimeAsync(0);

      expect(log.filter((entry) => entry.kind === "line-end")).toEqual([
        expect.objectContaining({
          line: expect.objectContaining({
            prompt: "[CHAT] mika: hi from mika",
          }),
          result: { status: "failed", text: "", error },
        }),
        expect.objectContaining({
          result: { status: "completed", text: "Back again." },
        }),
      ]);
      expect(calls).toHaveLength(2);
      expect(director.getSnapshot().inFlight).toBeNull();
      expect(director.getSnapshot().status).toBe("running");
      expect(director.getSnapshot().counters.linesFailed).toBe(1);
    },
  );
});

describe("createDirector: subscribers", () => {
  it("delivers batches in order, each with its own snapshot, when a listener pushes an event", () => {
    const { director, chat } = setup({ port: { durationMs: 1_000 } });
    type Seen = { kinds: string[]; queued: number; inFlight: string | null };
    const first: Seen[] = [];
    const second: Seen[] = [];
    const record =
      (into: Seen[]): DirectorListener =>
      (snapshot, entries) =>
        into.push({
          kinds: entries.map((entry) =>
            entry.kind === "decision"
              ? `decision:${(entry.event as { viewer?: string }).viewer}`
              : entry.kind,
          ),
          queued: snapshot.queue.length,
          inFlight: snapshot.inFlight?.prompt ?? null,
        });
    let pushed = false;
    director.subscribe((snapshot) => {
      // Reacting to the first line starting, push a chat of its own.
      if (!pushed && snapshot.inFlight) {
        pushed = true;
        chat.push(say("rin"));
      }
    });
    director.subscribe(record(first));
    director.subscribe(record(second));
    director.start();

    chat.push(say("mika"));

    const expected: Seen[] = [
      { kinds: [], queued: 0, inFlight: null },
      {
        kinds: ["decision:mika", "line-start"],
        queued: 0,
        inFlight: "[CHAT] mika: hi from mika",
      },
      {
        kinds: ["decision:rin"],
        queued: 1,
        inFlight: "[CHAT] mika: hi from mika",
      },
    ];
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(director.getSnapshot().queue).toHaveLength(1);
  });

  it("reports a throwing listener asynchronously and keeps the other listeners and the Director working", async () => {
    const reported: Array<() => void> = [];
    const microtasks = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((callback) => reported.push(callback));
    try {
      const boom = new Error("listener broke");
      const { director, chat, port, log } = setup({
        port: { durationMs: 1_000 },
      });
      director.subscribe(() => {
        throw boom;
      });
      const after: number[] = [];
      director.subscribe(() => after.push(after.length));

      // The throw happens inside start(), too: sources must still start and
      // the idle timer still arm.
      expect(() => director.start()).not.toThrow();
      expect(() => chat.push(say("mika"))).not.toThrow();

      expect(director.getSnapshot().status).toBe("running");
      expect(prompts(port)).toEqual(["[CHAT] mika: hi from mika"]);
      expect(after).toEqual([0, 1]);
      expect(log.map((entry) => entry.kind)).toEqual([
        "decision",
        "line-start",
      ]);
      expect(reported).toHaveLength(2);
      for (const callback of reported) expect(callback).toThrow(boom);

      await vi.advanceTimersByTimeAsync(1_000 + 5_000);
      expect(prompts(port)).toEqual(["[CHAT] mika: hi from mika", IDLE_PROMPT]);
    } finally {
      microtasks.mockRestore();
    }
  });
});

describe("createDirector: segments", () => {
  it("speaks the opening cue at start and reports the segment in the snapshot and the log", () => {
    const { director, port, log } = setup({ plan: showPlan });
    director.start();

    expect(prompts(port)).toEqual(["[DIRECTOR] Open."]);
    expect(director.getSnapshot().segmentIndex).toBe(0);
    expect(log).toContainEqual({
      kind: "segment",
      at: 0,
      index: 0,
      segment: showPlan.segments[0],
    });
  });

  it("waits for the line in flight at a segment start rather than cutting it", async () => {
    const { director, port } = setup({
      plan: showPlan,
      port: { durationMs: 15_000 },
    });
    director.start();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(director.getSnapshot().segmentIndex).toBe(1);
    expect(port.calls).toHaveLength(1);
    expect(director.getSnapshot().queue.map((line) => line.prompt)).toEqual([
      "[DIRECTOR] Talk games.",
    ]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(prompts(port)).toEqual([
      "[DIRECTOR] Open.",
      "[DIRECTOR] Talk games.",
    ]);
    expect(starts(port)).toEqual([0, 15_000]);
    expect(port.calls[0].result?.status).toBe("completed");
    expect(port.interruptCalls).toBe(0);
  });

  it("removes queued idle filler when a segment starts", async () => {
    const { director, port } = setup({
      plan: {
        segments: [
          { kind: "opening", title: "Hello", cue: "Open.", durationMs: 5_000 },
          ...showPlan.segments.slice(1),
        ],
      },
      port: { durationMs: 10 },
      config: { minLineIntervalMs: 9_000, idleAfterMs: 1_000 },
    });
    director.start();

    // Idle fires at 1,010 ms and waits in the queue for the interval.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(director.getSnapshot().queue.map((line) => line.source)).toEqual([
      "idle",
    ]);

    await vi.advanceTimersByTimeAsync(1);
    expect(director.getSnapshot().queue.map((line) => line.prompt)).toEqual([
      "[DIRECTOR] Talk games.",
    ]);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(prompts(port)).toEqual([
      "[DIRECTOR] Open.",
      "[DIRECTOR] Talk games.",
    ]);
    expect(starts(port)).toEqual([0, 9_000]);
  });

  it("does not stall on a segment cue whose line fails", async () => {
    const { director, port } = setup({
      plan: showPlan,
      port: {
        durationMs: 1_000,
        respond: (call) =>
          call.prompt === "[DIRECTOR] Open."
            ? { status: "failed", text: "", error: "HTTP 429" }
            : { status: "completed", text: `Reply ${call.index + 1}.` },
      },
    });
    director.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(director.getSnapshot()).toMatchObject({
      status: "running",
      segmentIndex: 0,
      counters: { linesFailed: 1 },
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(prompts(port)).toEqual([
      "[DIRECTOR] Open.",
      '[DIRECTOR] Chat is quiet. Keep the current topic, "Hello", going with one short new thought.',
    ]);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(director.getSnapshot().segmentIndex).toBe(1);
    expect(prompts(port).at(-1)).toBe("[DIRECTOR] Talk games.");
    expect(starts(port)).toEqual([0, 6_000, 10_000]);
  });
});

describe("createDirector: interrupt", () => {
  const triggers = [
    {
      name: "a highlighted chat",
      input: {
        kind: "chat",
        viewer: "mika",
        text: "big news!",
        highlighted: true,
      } satisfies ExternalShowEvent,
      prompt: "[CHAT] mika: big news!",
    },
    {
      name: "a high agent event",
      input: {
        kind: "agent",
        source: "game",
        text: "Boss appeared.",
        priority: "high",
      } satisfies ExternalShowEvent,
      prompt: "[EVENT] game: Boss appeared.",
    },
  ];
  // Filler starts at 5 s and is cut at 6 s. With a 7 s interval nothing may
  // start before 12 s; the slow orders hold the start to 14 s.
  const orders = [
    { order: "both settle at once", slow: null, startsAt: 12_000 },
    {
      order: "interrupt() first, speak() 8 s later",
      slow: "speak",
      startsAt: 14_000,
    },
    {
      order: "speak() first, interrupt() 8 s later",
      slow: "interrupt",
      startsAt: 14_000,
    },
  ] as const;
  const cases = triggers.flatMap((trigger) =>
    orders.map((order) => ({ ...trigger, ...order })),
  );

  it.each(cases)(
    "cuts idle filler for $name ($order): one interrupt(), no retry, the line waits for both and for the interval",
    async ({ input, prompt, slow, startsAt }) => {
      const fake = createFakePort({
        durationMs: 10_000,
        ...(slow === "speak" && { cancelSettlesAfterMs: 8_000 }),
      });
      const port: CharacterPort =
        slow === "interrupt"
          ? {
              speak: (text) => fake.speak(text),
              interrupt: async () => {
                await fake.interrupt();
                await new Promise((resolve) => setTimeout(resolve, 8_000));
              },
            }
          : fake;
      const chat = createPushSource();
      const agents = createPushSource();
      const director = createDirector({
        port,
        plan,
        config: {
          ...baseConfig,
          minLineIntervalMs: 7_000,
          interruptCooldownMs: 60_000,
        },
        sources: [chat, agents],
      });
      const log: DirectorLogEntry[] = [];
      director.subscribe((_snapshot, entries) => log.push(...entries));
      director.start();

      await vi.advanceTimersByTimeAsync(6_000);
      expect(director.getSnapshot().inFlight?.source).toBe("idle");
      (input.kind === "chat" ? chat : agents).push(input);
      expect(fake.interruptCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(startsAt - 6_000 - 1);
      expect(fake.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(prompts(fake)).toEqual([IDLE_PROMPT, prompt]);
      expect(starts(fake)).toEqual([5_000, startsAt]);
      expect(fake.peakUnsettled).toBe(1);

      // The cut filler is logged as cancelled and not queued again.
      expect(fake.calls[0].result?.status).toBe("cancelled");
      expect(director.getSnapshot().queue).toEqual([]);
      expect(director.getSnapshot().counters.linesCancelled).toBe(1);
      expect(
        log
          .filter((entry) => entry.kind === "line-start")
          .map((e) => e.line.source),
      ).toEqual(["idle", input.kind]);

      // The next filler is new, after the usual silence, and inside the
      // cooldown counted from the cut, so a second urgent event only queues.
      await vi.advanceTimersByTimeAsync(10_000 + 5_000);
      expect(starts(fake)).toEqual([5_000, startsAt, startsAt + 15_000]);
      expect(director.getSnapshot().inFlight?.source).toBe("idle");
      (input.kind === "chat" ? chat : agents).push(input);
      expect(log.at(-1)).toMatchObject({
        kind: "decision",
        decision: { kind: "enqueue" },
      });
      expect(fake.interruptCalls).toBe(1);
    },
  );

  it("still speaks a queued segment cue before the interrupting line", async () => {
    const { director, chat, port } = setup({
      plan: {
        segments: [
          { kind: "opening", title: "Hello", cue: "Open.", durationMs: 9_000 },
          ...showPlan.segments.slice(1),
        ],
      },
      port: { durationMs: 3_000, cancelSettlesAfterMs: 2_000 },
    });
    director.start();

    // Opening 0-3 s, filler from 8 s; cut at 8.5 s, settling at 10.5 s; the
    // topic starts at 9 s, while the cut is settling.
    await vi.advanceTimersByTimeAsync(8_500);
    chat.push({
      kind: "chat",
      viewer: "mika",
      text: "hey!",
      highlighted: true,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(director.getSnapshot().queue.map((line) => line.source)).toEqual([
      "segment",
      "chat",
    ]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(prompts(port).slice(2)).toEqual(["[DIRECTOR] Talk games."]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(prompts(port).slice(2)).toEqual([
      "[DIRECTOR] Talk games.",
      "[CHAT] mika: hey!",
    ]);
    expect(port.interruptCalls).toBe(1);
  });

  it("calls interrupt() once when a second urgent event arrives while the cut is settling", async () => {
    const { director, chat, port } = setup({
      port: { durationMs: 10_000, cancelSettlesAfterMs: 2_000 },
      config: { interruptCooldownMs: 0 },
    });
    director.start();

    await vi.advanceTimersByTimeAsync(6_000);
    chat.push({ kind: "chat", viewer: "mika", text: "one", highlighted: true });
    chat.push({ kind: "chat", viewer: "rin", text: "two", highlighted: true });
    expect(port.interruptCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(prompts(port)).toEqual([IDLE_PROMPT, "[CHAT] mika: one"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(prompts(port).slice(1)).toEqual([
      "[CHAT] mika: one",
      "[CHAT] rin: two",
    ]);
    expect(port.peakUnsettled).toBe(1);
  });
});

describe("createDirector: ending", () => {
  it.each(["completed", "failed"] as const)(
    "finishes when the ending line settles %s: queue cleared, sources stopped, no timer left",
    async (endStatus) => {
      const { director, chat, port } = setup({
        plan: showPlan,
        port: {
          durationMs: 2_000,
          respond: (call) =>
            call.prompt === "[DIRECTOR] Say goodbye." && endStatus === "failed"
              ? { status: "failed", text: "", error: "HTTP 503" }
              : { status: "completed", text: `Reply ${call.index + 1}.` },
        },
      });
      director.start();

      // The ending starts at 30 s, between fillers, and plays until 32 s.
      await vi.advanceTimersByTimeAsync(31_000);
      expect(director.getSnapshot()).toMatchObject({
        status: "running",
        segmentIndex: 2,
        inFlight: { prompt: "[DIRECTOR] Say goodbye." },
      });
      // Chat arriving once the ending has started is ignored, not queued
      // behind it to be wiped when the show finishes.
      chat.push({
        kind: "chat",
        viewer: "mika",
        text: "wait!",
        highlighted: true,
      });
      expect(director.getSnapshot().queue).toHaveLength(0);
      expect(director.getSnapshot().counters.eventsIgnored).toBe(1);
      expect(port.interruptCalls).toBe(0);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(port.calls.at(-1)?.result?.status).toBe(endStatus);
      expect(director.getSnapshot()).toMatchObject({
        status: "finished",
        inFlight: null,
        queue: [],
        segmentIndex: 2,
        error: null,
      });
      expect(vi.getTimerCount()).toBe(0);

      const spoken = port.calls.length;
      chat.push(say("rin"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(port.calls).toHaveLength(spoken);
    },
  );
});

describe("createDirector: ending order", () => {
  it("speaks chat accepted before the ending first, ignores later chat, and finishes after the ending line", async () => {
    const { director, chat, port } = setup({
      plan: {
        segments: [
          { kind: "opening", title: "Hi", cue: "Open.", durationMs: 4_000 },
          { kind: "ending", title: "Bye", cue: "Say goodbye." },
        ],
      },
      config: { minLineIntervalMs: 5_000 },
      port: { durationMs: 2_000 },
    });
    director.start();
    // Queued behind the 5 s line spacing, so it is still waiting when the
    // ending cue is accepted at 4 s.
    await vi.advanceTimersByTimeAsync(3_000);
    chat.push(say("rin"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(director.getSnapshot().queue.map((line) => line.prompt)).toEqual([
      "[CHAT] rin: hi from rin",
      "[DIRECTOR] Say goodbye.",
    ]);

    chat.push(say("mika"));
    expect(director.getSnapshot().counters.eventsIgnored).toBe(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(prompts(port)).toEqual([
      "[DIRECTOR] Open.",
      "[CHAT] rin: hi from rin",
      "[DIRECTOR] Say goodbye.",
    ]);
    expect(director.getSnapshot().status).toBe("finished");
  });
});

describe("createDirector: stop()", () => {
  it("interrupts the line in flight, clears the queue and every timer, and resolves once the cut has settled", async () => {
    let leakedEmit: ((event: ExternalShowEvent) => void) | null = null;
    // Keeps emitting after stop(), as a buggy source might.
    const leaky: ShowEventSource<ExternalShowEvent> = {
      start: (emit) => {
        leakedEmit = emit;
      },
      stop: () => {},
    };
    const chat = createPushSource();
    const { director, port, log } = setup({
      plan: showPlan,
      port: { durationMs: 10_000, cancelSettlesAfterMs: 2_000 },
      sources: [chat, leaky],
    });
    director.start();
    await vi.advanceTimersByTimeAsync(3_000);
    chat.push(say("mika"));

    let resolved = false;
    void director.stop().then(() => {
      resolved = true;
    });

    expect(port.interruptCalls).toBe(1);
    expect(director.getSnapshot()).toMatchObject({
      status: "stopped",
      inFlight: null,
      queue: [],
      error: null,
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    expect(port.calls[0].result?.status).toBe("cancelled");
    expect(vi.getTimerCount()).toBe(0);
    // Logged by the time stop() resolves, though the show had already ended.
    expect(log).toContainEqual({
      kind: "line-end",
      at: 5_000,
      line: expect.objectContaining({ prompt: "[DIRECTOR] Open." }),
      result: { status: "cancelled", text: "" },
      leak: false,
    });
    expect(director.getSnapshot().counters.linesCancelled).toBe(1);

    leakedEmit!(say("rin"));
    expect(log.at(-1)).toMatchObject({
      kind: "decision",
      decision: { kind: "ignore", reason: "show-not-running" },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prompts(port)).toEqual(["[DIRECTOR] Open."]);
    expect(port.interruptCalls).toBe(1);
  });

  it("waits for a cut already settling instead of interrupting again", async () => {
    const { director, chat, port, log } = setup({
      port: { durationMs: 10_000, cancelSettlesAfterMs: 2_000 },
    });
    director.start();
    // Filler from 5 s; cut at 6 s, its speak() settling at 8 s.
    await vi.advanceTimersByTimeAsync(6_000);
    chat.push({
      kind: "chat",
      viewer: "mika",
      text: "now!",
      highlighted: true,
    });
    await vi.advanceTimersByTimeAsync(500);

    let resolved = false;
    void director.stop().then(() => {
      resolved = true;
    });
    expect(port.interruptCalls).toBe(1);
    expect(director.getSnapshot().status).toBe("stopped");

    await vi.advanceTimersByTimeAsync(1_499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    expect(log.at(-1)).toMatchObject({
      kind: "line-end",
      result: { status: "cancelled" },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prompts(port)).toEqual([IDLE_PROMPT]);
    expect(port.interruptCalls).toBe(1);
    expect(director.getSnapshot().status).toBe("stopped");
  });

  it("resolves with status failed when the cut it waits for rejects", async () => {
    const { director, chat, port } = setup({
      port: { durationMs: 10_000, interruptError: new Error("stop failed") },
    });
    director.start();
    await vi.advanceTimersByTimeAsync(6_000);
    chat.push({
      kind: "chat",
      viewer: "mika",
      text: "now!",
      highlighted: true,
    });

    let resolved = false;
    void director.stop().then(() => {
      resolved = true;
    });
    expect(director.getSnapshot().status).toBe("stopped");

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    expect(port.interruptCalls).toBe(1);
    expect(director.getSnapshot()).toMatchObject({
      status: "failed",
      error: "stop failed",
    });
  });

  it("leaves no source started when a listener stops the show while start() is running", async () => {
    const external = createPushSource();
    vi.spyOn(external, "start");
    vi.spyOn(external, "stop");
    const { director, port, log } = setup({
      plan: showPlan,
      sources: [external],
    });
    // Stops as soon as the opening cue is in flight, inside start().
    director.subscribe((snapshot) => {
      if (snapshot.inFlight) void director.stop();
    });

    director.start();

    expect(director.getSnapshot().status).toBe("stopped");
    expect(external.start).not.toHaveBeenCalled();
    expect(external.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    external.push(say("mika"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prompts(port)).toEqual(["[DIRECTOR] Open."]);
    expect(
      log.some(
        (entry) => entry.kind === "decision" && entry.event.kind === "chat",
      ),
    ).toBe(false);
  });

  it("clears a pending line start without calling interrupt() when nothing is in flight", async () => {
    const { director, chat, port } = setup({
      port: { durationMs: 10 },
      config: { minLineIntervalMs: 7_000 },
    });
    director.start();
    chat.push(say("a"));
    await vi.advanceTimersByTimeAsync(10);
    chat.push(say("b"));
    expect(vi.getTimerCount()).toBe(1);

    await director.stop();

    expect(port.interruptCalls).toBe(0);
    expect(director.getSnapshot()).toMatchObject({
      status: "stopped",
      queue: [],
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(port.calls).toHaveLength(1);
  });

  it("clears an armed idle timer", async () => {
    const { director, port } = setup();
    director.start();
    expect(vi.getTimerCount()).toBe(1);

    await director.stop();

    expect(vi.getTimerCount()).toBe(0);
    expect(port.interruptCalls).toBe(0);
    expect(director.getSnapshot().status).toBe("stopped");
  });

  it("does nothing after the show finished", async () => {
    const { director, port } = setup({
      plan: { segments: [showPlan.segments[2]] },
      port: { durationMs: 1_000 },
    });
    director.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(director.getSnapshot().status).toBe("finished");

    await director.stop();

    expect(director.getSnapshot().status).toBe("finished");
    expect(port.interruptCalls).toBe(0);
  });
});

describe("createDirector: every source is stopped exactly once", () => {
  it.each(["finished", "stopped", "failed"] as const)(
    "when the show ends %s, and again on a later stop()",
    async (how) => {
      const external = createPushSource();
      vi.spyOn(external, "stop");
      const { director } = setup({
        plan: how === "finished" ? { segments: [showPlan.segments[2]] } : plan,
        port: {
          durationMs: 1_000,
          ...(how === "failed" && { interruptError: new Error("stop failed") }),
        },
        sources: [external],
      });
      director.start();
      const stops = [
        external.stop,
        internal.idleTimers.at(-1)!.stop,
        internal.schedulers.at(-1)!.stop,
      ];
      for (const stop of stops) expect(stop).not.toHaveBeenCalled();

      if (how === "finished") {
        await vi.advanceTimersByTimeAsync(1_000);
      } else if (how === "stopped") {
        await director.stop();
      } else {
        // Cut the filler that starts at 5 s; the interrupt rejects.
        await vi.advanceTimersByTimeAsync(5_500);
        external.push({
          kind: "chat",
          viewer: "mika",
          text: "now!",
          highlighted: true,
        });
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(director.getSnapshot().status).toBe(how);

      await director.stop();
      await director.stop();
      expect(director.getSnapshot().status).toBe(how);
      for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
    },
  );
});

describe("createDirector: a rejected interrupt", () => {
  const stopFailed = new Error("TTS stop failed");
  let rejections: unknown[];
  const onRejection = (reason: unknown) => rejections.push(reason);

  beforeEach(() => {
    rejections = [];
    process.on("unhandledRejection", onRejection);
  });

  afterEach(() => {
    process.off("unhandledRejection", onRejection);
  });

  // Unhandled rejections are reported after a real macrotask.
  async function expectNoUnhandledRejection() {
    vi.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    expect(rejections).toEqual([]);
  }

  it("on an interrupt decision: the urgent line never starts, the show fails with the error, and the late settle starts nothing", async () => {
    const { director, chat, port, log } = setup({
      port: { durationMs: 10_000, interruptError: stopFailed },
      config: { minLineIntervalMs: 0 },
    });
    director.start();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(director.getSnapshot().inFlight?.source).toBe("idle");

    chat.push({
      kind: "chat",
      viewer: "mika",
      text: "now!",
      highlighted: true,
    });
    chat.push(say("rin"));
    await vi.advanceTimersByTimeAsync(0);

    expect(port.interruptCalls).toBe(1);
    expect(director.getSnapshot()).toMatchObject({
      status: "failed",
      error: "TTS stop failed",
      inFlight: null,
      queue: [],
    });
    expect(log).toContainEqual({
      kind: "error",
      at: 6_000,
      message: "TTS stop failed",
    });
    // Only the port's own timer for the unsettled filler is left.
    expect(vi.getTimerCount()).toBe(1);

    // The filler plays out and settles late, at 15 s: it is logged, and
    // nothing follows it.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(port.calls[0].result?.status).toBe("completed");
    expect(log.at(-1)).toMatchObject({
      kind: "line-end",
      at: 15_000,
      line: { source: "idle" },
      result: { status: "completed" },
    });
    expect(director.getSnapshot().counters.linesSpoken).toBe(1);
    chat.push(say("sora"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prompts(port)).toEqual([IDLE_PROMPT]);
    expect(director.getSnapshot().status).toBe("failed");
    expect(vi.getTimerCount()).toBe(0);
    await expectNoUnhandledRejection();
  });

  it("on stop(): resolves without waiting for the unsettled speak(), with status failed", async () => {
    const { director, chat, port, log } = setup({
      plan: showPlan,
      port: { durationMs: 10_000, interruptError: stopFailed },
    });
    director.start();
    chat.push(say("mika"));

    let resolved = false;
    void director.stop().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(resolved).toBe(true);
    expect(port.calls[0].result).toBeNull();
    expect(director.getSnapshot()).toMatchObject({
      status: "failed",
      error: "TTS stop failed",
      queue: [],
    });
    expect(log).toContainEqual({
      kind: "error",
      at: 0,
      message: "TTS stop failed",
    });

    expect(log.some((entry) => entry.kind === "line-end")).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(port.calls[0].result?.status).toBe("completed");
    expect(log.filter((entry) => entry.kind === "line-end")).toEqual([
      expect.objectContaining({
        at: 10_000,
        result: expect.objectContaining({ status: "completed" }),
      }),
    ]);
    expect(prompts(port)).toEqual(["[DIRECTOR] Open."]);
    expect(director.getSnapshot().status).toBe("failed");
    expect(vi.getTimerCount()).toBe(0);
    await expectNoUnhandledRejection();
  });
});

describe("createDirector: a listener that pushes on every publish", () => {
  it("is cut off after a bounded number of passes and reported, instead of freezing the caller", () => {
    const reported: Array<() => void> = [];
    const microtasks = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((callback) => reported.push(callback));
    try {
      const { director, chat } = setup();
      director.start();
      let pushes = 0;
      // Bounded so the test ends even without the cap.
      director.subscribe(() => {
        if (pushes < 1_000) {
          pushes++;
          chat.push(say("mika"));
        }
      });

      chat.push(say("rin"));

      expect(pushes).toBe(100);
      // Not stale: every push has reached the snapshot, the 100th included.
      expect(director.getSnapshot().counters.eventsIgnored).toBe(99);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toThrow(/publish/);
      expect(director.getSnapshot().status).toBe("running");
    } finally {
      microtasks.mockRestore();
    }
  });
});

describe("createFakePort", () => {
  it("can give each line its own duration by call index", async () => {
    const port = createFakePort({ durationMs: (index) => (index + 1) * 100 });
    void port.speak("a");
    await vi.advanceTimersByTimeAsync(100);
    void port.speak("b");
    await vi.advanceTimersByTimeAsync(200);
    expect(port.calls.map((call) => call.endedAt)).toEqual([100, 300]);
  });

  it("settles the cancelled speak() before interrupt() resolves by default", async () => {
    const port = createFakePort({ durationMs: 10_000 });
    const order: string[] = [];
    void port.speak("a").then((result) => order.push(`speak:${result.status}`));
    await port.interrupt().then(() => order.push("interrupt"));
    expect(order).toEqual(["speak:cancelled", "interrupt"]);
  });

  it("can resolve interrupt() first and settle the cancelled speak() later", async () => {
    const port = createFakePort({
      durationMs: 10_000,
      cancelSettlesAfterMs: 50,
    });
    const order: string[] = [];
    void port.speak("a").then((result) => order.push(`speak:${result.status}`));
    await port.interrupt().then(() => order.push("interrupt"));
    expect(order).toEqual(["interrupt"]);
    await vi.advanceTimersByTimeAsync(50);
    expect(order).toEqual(["interrupt", "speak:cancelled"]);
    expect(port.calls[0].endedAt).toBe(50);
  });
});
