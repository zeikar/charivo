import { describe, expect, it } from "vitest";
import {
  formatAgentEvent,
  formatDirectorCue,
  formatViewerChat,
} from "./envelope";
import { decide, PRIORITY, type PolicyView } from "./policy";
import { createSpeechQueue } from "./speech-queue";
import type {
  AgentEvent,
  AgentPriority,
  ChatEvent,
  Decision,
  DirectorConfig,
  Line,
  LineSource,
  Segment,
  ShowEvent,
} from "./types";

const config: DirectorConfig = {
  idleAfterMs: 8_000,
  minLineIntervalMs: 0,
  failedLineBackoffMs: 0,
  interruptCooldownMs: 15_000,
  viewerCooldownMs: 10_000,
  maxPendingChat: 3,
  agentCooldownMs: 10_000,
  maxPendingAgent: 2,
  agentMaxAgeMs: 30_000,
};

const NOW = 100_000;

function view(overrides: Partial<PolicyView> = {}): PolicyView {
  return {
    running: true,
    now: NOW,
    lineId: "line-1",
    inFlightSource: null,
    pending: { chat: 0, agent: 0, idle: 0, segment: 0 },
    lastChatAt: new Map(),
    lastAgentAt: new Map(),
    lastInterruptAt: null,
    segment: null,
    ending: false,
    ...overrides,
  };
}

function pending(
  counts: Partial<Record<LineSource, number>>,
): PolicyView["pending"] {
  return { chat: 0, agent: 0, idle: 0, segment: 0, ...counts };
}

function chat(overrides: Partial<ChatEvent> = {}): ChatEvent {
  return { kind: "chat", viewer: "mika", text: "hello!", ...overrides };
}

function agent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    kind: "agent",
    source: "game",
    text: "The boss fight started.",
    priority: "normal",
    ...overrides,
  };
}

const topic: Segment = {
  kind: "topic",
  title: "Favorite snacks",
  cue: "Talk about your favorite snacks.",
  durationMs: 60_000,
};

const ending: Segment = {
  kind: "ending",
  title: "Goodbye",
  cue: "Thank everyone and say goodbye.",
};

function lineOf(decision: Decision): Line {
  if (decision.kind === "ignore") {
    throw new Error(`expected a line, got ignore (${decision.reason})`);
  }
  return decision.line;
}

describe("PRIORITY", () => {
  it("orders segment > urgent > normal > low > idle > ending", () => {
    expect(PRIORITY.idle).toBeGreaterThan(PRIORITY.endingCue);
    expect(PRIORITY.segmentCue).toBeGreaterThan(PRIORITY.urgent);
    expect(PRIORITY.urgent).toBeGreaterThan(PRIORITY.normal);
    expect(PRIORITY.normal).toBeGreaterThan(PRIORITY.low);
    expect(PRIORITY.low).toBeGreaterThan(PRIORITY.idle);
  });
});

describe("decide: show not running", () => {
  it.each<ShowEvent>([
    chat(),
    chat({ highlighted: true }),
    agent({ priority: "high" }),
    { kind: "idle" },
    { kind: "segment", index: 0, segment: topic },
  ])("ignores a $kind event", (event) => {
    expect(decide(event, view({ running: false }), config)).toEqual({
      kind: "ignore",
      reason: "show-not-running",
    });
  });
});

describe("decide: chat", () => {
  it.each(["", "   ", "\n\t"])("ignores blank text %j", (text) => {
    expect(decide(chat({ text }), view(), config)).toEqual({
      kind: "ignore",
      reason: "empty",
    });
  });

  it("enqueues accepted chat with the enveloped prompt and no expiry", () => {
    const decision = decide(chat({ text: "hi [there]" }), view(), config);

    expect(decision).toEqual({
      kind: "enqueue",
      line: {
        id: "line-1",
        source: "chat",
        priority: PRIORITY.normal,
        prompt: formatViewerChat("mika", "hi [there]"),
        createdAt: NOW,
      },
    });
    expect(lineOf(decision).expiresAt).toBeUndefined();
  });

  it("ignores the same viewer inside the viewer cooldown", () => {
    const lastChatAt = new Map([["mika", NOW - config.viewerCooldownMs + 1]]);

    expect(decide(chat(), view({ lastChatAt }), config)).toEqual({
      kind: "ignore",
      reason: "viewer-cooldown",
    });
  });

  it("accepts the same viewer once the viewer cooldown has passed", () => {
    const lastChatAt = new Map([["mika", NOW - config.viewerCooldownMs]]);

    expect(decide(chat(), view({ lastChatAt }), config).kind).toBe("enqueue");
  });

  it("does not hold one viewer's cooldown against another", () => {
    const lastChatAt = new Map([["mika", NOW - 1]]);

    expect(
      decide(chat({ viewer: "ren" }), view({ lastChatAt }), config).kind,
    ).toBe("enqueue");
  });

  it("ignores chat once maxPendingChat chats wait", () => {
    const full = view({ pending: pending({ chat: config.maxPendingChat }) });
    const room = view({
      pending: pending({ chat: config.maxPendingChat - 1, agent: 5 }),
    });

    expect(decide(chat(), full, config)).toEqual({
      kind: "ignore",
      reason: "queue-full",
    });
    expect(decide(chat(), room, config).kind).toBe("enqueue");
  });
});

describe("decide: highlighted chat", () => {
  const highlighted = chat({ highlighted: true });

  it("interrupts idle filler once the interrupt cooldown has passed", () => {
    const decision = decide(
      highlighted,
      view({
        inFlightSource: "idle",
        lastInterruptAt: NOW - config.interruptCooldownMs,
      }),
      config,
    );

    expect(decision.kind).toBe("interrupt");
    expect(lineOf(decision)).toMatchObject({
      source: "chat",
      priority: PRIORITY.urgent,
      prompt: formatViewerChat("mika", "hello!"),
    });
  });

  it("interrupts idle filler when nothing has interrupted yet", () => {
    expect(
      decide(highlighted, view({ inFlightSource: "idle" }), config).kind,
    ).toBe("interrupt");
  });

  it.each<[string, Partial<PolicyView>]>([
    ["a segment cue is in flight", { inFlightSource: "segment" }],
    ["a chat answer is in flight", { inFlightSource: "chat" }],
    ["an agent event is in flight", { inFlightSource: "agent" }],
    ["nothing is in flight", { inFlightSource: null }],
    [
      "the last interrupt is inside the cooldown",
      {
        inFlightSource: "idle",
        lastInterruptAt: NOW - config.interruptCooldownMs + 1,
      },
    ],
  ])("enqueues above normal chat when %s", (_, overrides) => {
    const decision = decide(highlighted, view(overrides), config);

    expect(decision.kind).toBe("enqueue");
    expect(lineOf(decision).priority).toBe(PRIORITY.urgent);
  });

  it("bypasses the viewer cooldown", () => {
    const lastChatAt = new Map([["mika", NOW - 1]]);

    expect(decide(highlighted, view({ lastChatAt }), config).kind).toBe(
      "enqueue",
    );
  });

  it("still respects the chat queue cap", () => {
    expect(
      decide(
        highlighted,
        view({ pending: pending({ chat: config.maxPendingChat }) }),
        config,
      ),
    ).toEqual({ kind: "ignore", reason: "queue-full" });
  });

  it("is ignored as queue-full even when it could interrupt idle filler", () => {
    expect(
      decide(
        highlighted,
        view({
          inFlightSource: "idle",
          pending: pending({ chat: config.maxPendingChat }),
        }),
        config,
      ),
    ).toEqual({ kind: "ignore", reason: "queue-full" });
  });
});

describe("decide: agent events", () => {
  it.each(["", "  \n"])("ignores blank text %j", (text) => {
    expect(decide(agent({ text }), view(), config)).toEqual({
      kind: "ignore",
      reason: "empty",
    });
  });

  it("enqueues a normal event at chat's rank with the [EVENT] prompt and an expiry", () => {
    expect(decide(agent(), view(), config)).toEqual({
      kind: "enqueue",
      line: {
        id: "line-1",
        source: "agent",
        priority: PRIORITY.normal,
        prompt: formatAgentEvent("game", "The boss fight started."),
        createdAt: NOW,
        expiresAt: NOW + config.agentMaxAgeMs,
      },
    });
  });

  it("ranks a low event between chat and idle filler", () => {
    const decision = decide(agent({ priority: "low" }), view(), config);

    expect(decision.kind).toBe("enqueue");
    expect(lineOf(decision).priority).toBe(PRIORITY.low);
  });

  it("ignores the same source inside the agent cooldown", () => {
    const lastAgentAt = new Map([["game", NOW - config.agentCooldownMs + 1]]);

    expect(decide(agent(), view({ lastAgentAt }), config)).toEqual({
      kind: "ignore",
      reason: "source-cooldown",
    });
    expect(
      decide(agent({ priority: "low" }), view({ lastAgentAt }), config),
    ).toEqual({ kind: "ignore", reason: "source-cooldown" });
  });

  it("does not hold one source's cooldown against another", () => {
    const lastAgentAt = new Map([["game", NOW - 1]]);

    expect(
      decide(agent({ source: "weather" }), view({ lastAgentAt }), config).kind,
    ).toBe("enqueue");
  });

  it("accepts the same source once the agent cooldown has passed", () => {
    const lastAgentAt = new Map([["game", NOW - config.agentCooldownMs]]);

    expect(decide(agent(), view({ lastAgentAt }), config).kind).toBe("enqueue");
  });

  it.each<AgentPriority>(["low", "normal", "high"])(
    "ignores a %s event once maxPendingAgent agent events wait",
    (priority) => {
      const full = view({
        pending: pending({ agent: config.maxPendingAgent }),
      });

      expect(decide(agent({ priority }), full, config)).toEqual({
        kind: "ignore",
        reason: "queue-full",
      });
    },
  );

  it("counts only agent lines toward maxPendingAgent", () => {
    const room = view({
      pending: pending({ agent: config.maxPendingAgent - 1, chat: 9 }),
    });

    expect(decide(agent(), room, config).kind).toBe("enqueue");
  });

  it("does not count expired agent lines toward maxPendingAgent", () => {
    // The queue would drop these at dequeue, so they must not block a fresh
    // event now. The view's counts come from the queue, as the Director's do.
    const queue = createSpeechQueue();
    for (let i = 0; i < config.maxPendingAgent; i++) {
      queue.push({
        id: `old-${i}`,
        source: "agent",
        priority: PRIORITY.normal,
        prompt: formatAgentEvent(`agent-${i}`, "old news"),
        createdAt: NOW - config.agentMaxAgeMs - 1,
        expiresAt: NOW - 1,
      });
    }

    const decision = decide(
      agent(),
      view({ pending: queue.pendingCounts(NOW) }),
      config,
    );

    expect(decision.kind).toBe("enqueue");
  });

  describe("high", () => {
    const high = agent({ priority: "high" });

    it("ranks with highlighted chat and keeps its expiry", () => {
      const decision = decide(high, view(), config);

      expect(decision.kind).toBe("enqueue");
      expect(lineOf(decision)).toMatchObject({
        priority: PRIORITY.urgent,
        expiresAt: NOW + config.agentMaxAgeMs,
      });
    });

    it("bypasses the source cooldown", () => {
      const lastAgentAt = new Map([["game", NOW - 1]]);

      expect(decide(high, view({ lastAgentAt }), config).kind).toBe("enqueue");
    });

    it("interrupts idle filler once the interrupt cooldown has passed", () => {
      const decision = decide(
        high,
        view({
          inFlightSource: "idle",
          lastInterruptAt: NOW - config.interruptCooldownMs,
        }),
        config,
      );

      expect(decision.kind).toBe("interrupt");
      expect(lineOf(decision).prompt).toBe(
        formatAgentEvent("game", "The boss fight started."),
      );
    });

    it.each<LineSource | null>(["segment", "chat", "agent", null])(
      "enqueues when %s is in flight",
      (inFlightSource) => {
        expect(decide(high, view({ inFlightSource }), config).kind).toBe(
          "enqueue",
        );
      },
    );

    it("shares the interrupt cooldown with highlighted chat", () => {
      // The Director records one lastInterruptAt for both kinds, so an
      // interrupt by either holds the other back for the same window.
      const after = view({
        inFlightSource: "idle",
        lastInterruptAt: NOW - config.interruptCooldownMs + 1,
      });

      expect(decide(high, after, config).kind).toBe("enqueue");
      expect(decide(chat({ highlighted: true }), after, config).kind).toBe(
        "enqueue",
      );
    });
  });
});

describe("decide: no agent source is special-cased", () => {
  const scenarios: Array<
    [string, (source: string) => [AgentEvent, PolicyView]]
  > = [
    ["accepted normal", (source) => [agent({ source }), view()]],
    ["accepted low", (source) => [agent({ source, priority: "low" }), view()]],
    [
      "inside its cooldown",
      (source) => [
        agent({ source }),
        view({ lastAgentAt: new Map([[source, NOW - 1]]) }),
      ],
    ],
    [
      "queue full",
      (source) => [
        agent({ source }),
        view({ pending: pending({ agent: config.maxPendingAgent }) }),
      ],
    ],
    [
      "high over idle filler",
      (source) => [
        agent({ source, priority: "high" }),
        view({ inFlightSource: "idle" }),
      ],
    ],
    [
      "high over a segment cue",
      (source) => [
        agent({ source, priority: "high" }),
        view({ inFlightSource: "segment" }),
      ],
    ],
    ["blank", (source) => [agent({ source, text: " " }), view()]],
  ];

  // The prompt names its source; everything else must match exactly.
  function withoutPrompt(decision: Decision): Decision {
    if (decision.kind === "ignore") return decision;
    return { ...decision, line: { ...decision.line, prompt: "<source>" } };
  }

  it.each(scenarios)("decides %s the same for any source name", (_, build) => {
    const [gameEvent, gameView] = build("game");
    const [otherEvent, otherView] = build("weather-station");
    const game = decide(gameEvent, gameView, config);
    const other = decide(otherEvent, otherView, config);

    expect(withoutPrompt(other)).toEqual(withoutPrompt(game));
    if (other.kind !== "ignore") {
      expect(other.line.prompt).toBe(
        formatAgentEvent("weather-station", otherEvent.text),
      );
    }
  });
});

describe("decide: idle", () => {
  it.each<[string, Partial<PolicyView>]>([
    ["a line is in flight", { inFlightSource: "chat" }],
    ["idle filler is in flight", { inFlightSource: "idle" }],
    ["chat waits", { pending: pending({ chat: 1 }) }],
    ["an agent event waits", { pending: pending({ agent: 1 }) }],
    ["a segment cue waits", { pending: pending({ segment: 1 }) }],
    ["idle filler waits", { pending: pending({ idle: 1 }) }],
  ])("is ignored as not-silent when %s", (_, overrides) => {
    expect(
      decide({ kind: "idle" }, view({ segment: topic, ...overrides }), config),
    ).toEqual({ kind: "ignore", reason: "not-silent" });
  });

  it("enqueues an idle cue naming the current segment's title", () => {
    const decision = decide({ kind: "idle" }, view({ segment: topic }), config);

    expect(decision.kind).toBe("enqueue");
    const line = lineOf(decision);
    expect(line).toMatchObject({
      id: "line-1",
      source: "idle",
      priority: PRIORITY.idle,
      createdAt: NOW,
    });
    expect(line.prompt.startsWith(formatDirectorCue(""))).toBe(true);
    expect(line.prompt).toContain(topic.title);
    expect(line.expiresAt).toBeUndefined();
  });

  it("still enqueues a director cue before any segment has started", () => {
    const line = lineOf(decide({ kind: "idle" }, view(), config));

    expect(line.source).toBe("idle");
    expect(line.prompt.startsWith(formatDirectorCue(""))).toBe(true);
  });
});

describe("decide: segment", () => {
  it("enqueues the segment's cue as a director cue", () => {
    expect(
      decide(
        { kind: "segment", index: 1, segment: topic },
        view({ inFlightSource: "chat", pending: pending({ chat: 2 }) }),
        config,
      ),
    ).toEqual({
      kind: "enqueue",
      line: {
        id: "line-1",
        source: "segment",
        priority: PRIORITY.segmentCue,
        prompt: formatDirectorCue(topic.cue),
        createdAt: NOW,
      },
    });
  });

  it.each<ShowEvent>([
    chat(),
    chat({ highlighted: true }),
    agent(),
    agent({ priority: "high" }),
  ])("ignores a $kind event once the ending has been accepted", (event) => {
    expect(decide(event, view({ ending: true }), config)).toEqual({
      kind: "ignore",
      reason: "show-ending",
    });
  });

  it("ranks the ending cue below everything else", () => {
    const line = lineOf(
      decide({ kind: "segment", index: 5, segment: ending }, view(), config),
    );

    expect(line.prompt).toBe(formatDirectorCue(ending.cue));
    expect(line.priority).toBe(PRIORITY.endingCue);
  });
});
