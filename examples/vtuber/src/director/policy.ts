// The attention policy, in one place. decide() is pure: the Director owns
// every piece of state it reads, passes it in through PolicyView, and updates
// that state itself after acting on the decision.

import {
  formatAgentEvent,
  formatDirectorCue,
  formatViewerChat,
} from "./envelope";
import type {
  AgentEvent,
  AgentPriority,
  ChatEvent,
  Decision,
  DirectorConfig,
  Line,
  LineSource,
  Segment,
  SegmentEvent,
  ShowEvent,
} from "./types";

/**
 * Line ranks. Higher is spoken first. The ending cue ranks last: it closes
 * the show and finishing clears the queue, so whatever was accepted before
 * it must be spoken first.
 */
export const PRIORITY = {
  endingCue: -1,
  segmentCue: 4,
  /** Highlighted chat and `high` agent events. */
  urgent: 3,
  /** Chat and `normal` agent events. */
  normal: 2,
  /** `low` agent events. */
  low: 1,
  idle: 0,
} as const;

const AGENT_RANK: Record<AgentPriority, number> = {
  high: PRIORITY.urgent,
  normal: PRIORITY.normal,
  low: PRIORITY.low,
};

export interface PolicyView {
  running: boolean;
  now: number;
  /**
   * The id a line created by this decision gets. Passing it in keeps decide()
   * pure; the Director moves to a fresh id only when a line was created.
   */
  lineId: string;
  /** Source of the line whose speak() is unsettled, or null. */
  inFlightSource: LineSource | null;
  /** Lines waiting in the speech queue, per source. */
  pending: Readonly<Record<LineSource, number>>;
  /** Last accepted chat time, per viewer. */
  lastChatAt: ReadonlyMap<string, number>;
  /** Last accepted agent event time, per agent `source`. */
  lastAgentAt: ReadonlyMap<string, number>;
  /**
   * Last interrupt of either kind, or null when none has happened. Set it
   * when the interrupt decision is made, not when it settles: decide() is
   * pure and would otherwise allow a second interrupt of the same filler.
   */
  lastInterruptAt: number | null;
  segment: Segment | null;
  /** True once the ending cue has been accepted: no new chat or agent event is. */
  ending: boolean;
}

// "stale" is never returned here: a line goes stale while it waits, so the
// Director reports it when the queue drops it at dequeue.
export function decide(
  event: ShowEvent,
  view: PolicyView,
  config: DirectorConfig,
): Decision {
  if (!view.running) return { kind: "ignore", reason: "show-not-running" };
  // Anything accepted now would be queued behind the ending cue, which goes
  // last, or be wiped when the show finishes.
  if (view.ending && (event.kind === "chat" || event.kind === "agent")) {
    return { kind: "ignore", reason: "show-ending" };
  }

  switch (event.kind) {
    case "chat":
      return decideChat(event, view, config);
    case "agent":
      return decideAgent(event, view, config);
    case "idle":
      return decideIdle(view);
    case "segment":
      return decideSegment(event, view);
  }
}

function decideChat(
  event: ChatEvent,
  view: PolicyView,
  config: DirectorConfig,
): Decision {
  if (isBlank(event.text)) return { kind: "ignore", reason: "empty" };
  const highlighted = event.highlighted === true;
  if (
    !highlighted &&
    within(view.lastChatAt.get(event.viewer), config.viewerCooldownMs, view.now)
  ) {
    return { kind: "ignore", reason: "viewer-cooldown" };
  }
  if (view.pending.chat >= config.maxPendingChat) {
    return { kind: "ignore", reason: "queue-full" };
  }
  const line: Line = {
    id: view.lineId,
    source: "chat",
    priority: highlighted ? PRIORITY.urgent : PRIORITY.normal,
    prompt: formatViewerChat(event.viewer, event.text),
    createdAt: view.now,
  };
  return highlighted ? urgent(line, view, config) : { kind: "enqueue", line };
}

// Same three rules as chat, keyed by the free-form `source` string; no name
// is treated differently from another.
function decideAgent(
  event: AgentEvent,
  view: PolicyView,
  config: DirectorConfig,
): Decision {
  if (isBlank(event.text)) return { kind: "ignore", reason: "empty" };
  const high = event.priority === "high";
  if (
    !high &&
    within(view.lastAgentAt.get(event.source), config.agentCooldownMs, view.now)
  ) {
    return { kind: "ignore", reason: "source-cooldown" };
  }
  if (view.pending.agent >= config.maxPendingAgent) {
    return { kind: "ignore", reason: "queue-full" };
  }
  const line: Line = {
    id: view.lineId,
    source: "agent",
    priority: AGENT_RANK[event.priority],
    prompt: formatAgentEvent(event.source, event.text),
    createdAt: view.now,
    // An event is about a moment in the world; once old it is no longer news.
    expiresAt: view.now + config.agentMaxAgeMs,
  };
  return high ? urgent(line, view, config) : { kind: "enqueue", line };
}

function decideIdle(view: PolicyView): Decision {
  const waiting = Object.values(view.pending).some((count) => count > 0);
  if (view.inFlightSource !== null || waiting) {
    return { kind: "ignore", reason: "not-silent" };
  }
  // The Director can run before any segment has started (no scheduler, or
  // a plan-less test), so the cue must not depend on one.
  const cue = view.segment
    ? `Chat is quiet. Keep the current topic, "${view.segment.title}", going with one short new thought.`
    : "Chat is quiet. Keep the stream going with one short new thought.";
  return {
    kind: "enqueue",
    line: {
      id: view.lineId,
      source: "idle",
      priority: PRIORITY.idle,
      prompt: formatDirectorCue(cue),
      createdAt: view.now,
    },
  };
}

// Discarding queued idle filler on a segment start is the Director's job
// (queue.removeWhere); the policy only creates the cue.
function decideSegment(event: SegmentEvent, view: PolicyView): Decision {
  return {
    kind: "enqueue",
    line: {
      id: view.lineId,
      source: "segment",
      priority:
        event.segment.kind === "ending"
          ? PRIORITY.endingCue
          : PRIORITY.segmentCue,
      prompt: formatDirectorCue(event.segment.cue),
      createdAt: view.now,
    },
  };
}

// Only idle filler is worth cutting off; anything else in flight was chosen
// on purpose, so an urgent line waits its turn in the queue. An `interrupt`
// does not jump the queue either: the Director pushes the line, cuts the
// filler, then drains by priority, so a queued segment or ending cue still
// goes first.
function urgent(
  line: Line,
  view: PolicyView,
  config: DirectorConfig,
): Decision {
  const canInterrupt =
    view.inFlightSource === "idle" &&
    !within(view.lastInterruptAt, config.interruptCooldownMs, view.now);
  return { kind: canInterrupt ? "interrupt" : "enqueue", line };
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

/** True when `since` is set and less than `windowMs` before `now`. */
function within(
  since: number | null | undefined,
  windowMs: number,
  now: number,
): boolean {
  return since !== null && since !== undefined && now - since < windowMs;
}
