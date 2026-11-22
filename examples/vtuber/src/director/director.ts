// The Director: an event loop that decides when the character speaks. Every
// input arrives through a ShowEventSource and goes through decide(); the
// character is reached only through CharacterPort, one line at a time.

import { findCueLeak } from "./envelope";
import { createIdleTimer } from "./idle-timer";
import { decide, type PolicyView } from "./policy";
import { createSpeechQueue } from "./speech-queue";
import type {
  CharacterPort,
  DirectorConfig,
  DirectorCounters,
  DirectorLogEntry,
  DirectorSnapshot,
  DirectorStatus,
  ExternalShowEvent,
  Line,
  ShowEvent,
  ShowEventSource,
  ShowPlan,
  SpeakResult,
} from "./types";

export interface DirectorOptions {
  port: CharacterPort;
  plan: ShowPlan;
  config: DirectorConfig;
  /** Inputs from outside the show, such as chat and agents. */
  sources?: readonly ShowEventSource<ExternalShowEvent>[];
}

/**
 * Gets the new snapshot and the log entries added since the last publish. A
 * listener added later misses the earlier entries, so subscribe before start().
 */
export type DirectorListener = (
  snapshot: DirectorSnapshot,
  entries: readonly DirectorLogEntry[],
) => void;

export interface Director {
  start(): void;
  getSnapshot(): DirectorSnapshot;
  /** Returns the function that unsubscribes `listener`. */
  subscribe(listener: DirectorListener): () => void;
}

export function createDirector({
  port,
  config,
  sources = [],
}: DirectorOptions): Director {
  const queue = createSpeechQueue();
  const idleTimer = createIdleTimer(config.idleAfterMs);
  // Internal and external inputs share one lifecycle and one dispatch. The
  // idle timer goes first so it can be armed by anything a later source
  // emits while starting.
  const allSources: ShowEventSource<ShowEvent>[] = [idleTimer, ...sources];

  let status: DirectorStatus = "ready";
  let inFlight: Line | null = null;
  let nextLineNumber = 1;
  const lastChatAt = new Map<string, number>();
  const lastAgentAt = new Map<string, number>();
  let lastInterruptAt: number | null = null;
  let lastStartAt: number | null = null;
  let lastLineFailed = false;
  // The only timer that starts a line; never more than one is pending.
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  const counters: DirectorCounters = {
    linesSpoken: 0,
    linesCancelled: 0,
    linesFailed: 0,
    eventsIgnored: 0,
    cueLeaks: 0,
  };

  const listeners = new Set<DirectorListener>();
  let unpublished: DirectorLogEntry[] = [];
  let publishing = false;
  let republish = false;
  let snapshot = buildSnapshot();

  function view(now: number): PolicyView {
    return {
      running: status === "running",
      now,
      lineId: `line-${nextLineNumber}`,
      inFlightSource: inFlight?.source ?? null,
      pending: queue.pendingCounts(now),
      lastChatAt,
      lastAgentAt,
      lastInterruptAt,
      segment: null,
    };
  }

  function dispatch(event: ShowEvent): void {
    const now = Date.now();
    const decision = decide(event, view(now), config);
    log({ kind: "decision", at: now, event, decision });
    if (decision.kind === "ignore") {
      counters.eventsIgnored++;
    } else {
      nextLineNumber++;
      if (event.kind === "chat") lastChatAt.set(event.viewer, now);
      if (event.kind === "agent") lastAgentAt.set(event.source, now);
      queue.push(Object.freeze(decision.line));
      if (decision.kind === "interrupt") {
        // Set at decision time so a second urgent event cannot cut the same
        // filler. Cutting the filler itself is not wired yet: until then the
        // line waits in the queue like an enqueued one.
        lastInterruptAt = now;
      }
      drain();
    }
    publish();
  }

  // Starts the next line if one can start now. Silence is judged here, after
  // the queue has been served, not from the queue's size when a line settled.
  function drain(): void {
    if (status !== "running" || inFlight !== null || startTimer !== null) {
      return;
    }
    const now = Date.now();
    const fresh = Object.values(queue.pendingCounts(now)).some((n) => n > 0);
    const wait = earliestStart() - now;
    if (fresh && wait > 0) {
      // Something is waiting, so an idle tick now would only be ignored. The
      // drain when the timer fires arms it again if nothing is left to say.
      idleTimer.cancel();
      // Which line goes first is decided when the timer fires, so anything
      // queued meanwhile is served by priority.
      startTimer = setTimeout(() => {
        startTimer = null;
        drain();
        publish();
      }, wait);
      return;
    }
    const { line, dropped } = queue.shift(now);
    for (const stale of dropped) {
      log({ kind: "line-dropped", at: now, line: stale, reason: "stale" });
    }
    if (line) startLine(line, now);
    else idleTimer.arm();
  }

  // Lines are spaced from the previous start, never from its end. After a
  // failed line the wait is the longer of the interval and the backoff, which
  // eases off a provider that is failing; a completed line resets it.
  function earliestStart(): number {
    if (lastStartAt === null) return -Infinity;
    const gap = lastLineFailed
      ? Math.max(config.minLineIntervalMs, config.failedLineBackoffMs)
      : config.minLineIntervalMs;
    return lastStartAt + gap;
  }

  function startLine(line: Line, now: number): void {
    idleTimer.cancel();
    inFlight = line;
    lastStartAt = now;
    log({ kind: "line-start", at: now, line });
    // The port should always resolve, but it is app code: a throw or a
    // rejection must not leave this line in flight forever, so either one
    // ends it as a failed line. A sync throw is caught here rather than by
    // deferring the call, so speak() still starts in this tick.
    let speaking: Promise<SpeakResult>;
    try {
      speaking = port.speak(line.prompt);
    } catch (error) {
      speaking = Promise.reject(error);
    }
    speaking.then(
      (result) => settle(line, result),
      (error: unknown) =>
        settle(line, {
          status: "failed",
          text: "",
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  function settle(line: Line, result: SpeakResult): void {
    inFlight = null;
    lastLineFailed = result.status === "failed";
    // A failed line is counted and skipped like any other end: no retry, and
    // the show carries on. Status `failed` is not for this.
    if (result.status === "completed") counters.linesSpoken++;
    else if (result.status === "cancelled") counters.linesCancelled++;
    else counters.linesFailed++;
    // Every reply is checked: a cue kept in history can resurface in a later
    // chat answer, not only in a cue's own line.
    const leak = findCueLeak(result.text);
    if (leak) counters.cueLeaks++;
    log({ kind: "line-end", at: Date.now(), line, result, leak });
    drain();
    publish();
  }

  function log(entry: DirectorLogEntry): void {
    unpublished.push(entry);
  }

  function buildSnapshot(): DirectorSnapshot {
    return Object.freeze({
      status,
      segmentIndex: null,
      segment: null,
      inFlight,
      queue: Object.freeze(queue.snapshot()),
      counters: Object.freeze({ ...counters }),
      error: null,
    });
  }

  // A listener may push an event, which publishes again. That nested publish
  // is folded into another pass of the outer loop, so every listener gets the
  // batches in order, each with the snapshot it was built with.
  function publish(): void {
    if (publishing) {
      republish = true;
      return;
    }
    publishing = true;
    do {
      republish = false;
      const current = buildSnapshot();
      snapshot = current;
      const entries = unpublished;
      unpublished = [];
      for (const listener of listeners) {
        try {
          listener(current, entries);
        } catch (error) {
          // Reported, but not allowed to stop the other listeners or leave
          // the Director half-updated (e.g. sources unstarted in start()).
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    } while (republish);
    publishing = false;
  }

  return {
    start() {
      if (status !== "ready") return;
      status = "running";
      for (const source of allSources) source.start(dispatch);
      drain();
      publish();
    },

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
