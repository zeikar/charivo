// The Director: an event loop that decides when the character speaks. Every
// input arrives through a ShowEventSource and goes through decide(); the
// character is reached only through CharacterPort, one line at a time.

import { findCueLeak } from "./envelope";
import { createIdleTimer } from "./idle-timer";
import { decide, type PolicyView } from "./policy";
import { createSegmentScheduler } from "./segment-scheduler";
import { createSpeechQueue } from "./speech-queue";
import type {
  CharacterPort,
  Decision,
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
  /**
   * Ends a running show as `stopped`: timers, queue and sources are stopped at
   * once, and the line in flight is interrupted. Resolves once that line is
   * over and logged, or at once when the interrupt rejected (status
   * `failed`). Never rejects; does nothing when the show is not running.
   */
  stop(): Promise<void>;
  getSnapshot(): DirectorSnapshot;
  /** Returns the function that unsubscribes `listener`. */
  subscribe(listener: DirectorListener): () => void;
}

const MAX_PUBLISH_PASSES = 100;

export function createDirector({
  port,
  plan,
  config,
  sources = [],
}: DirectorOptions): Director {
  const queue = createSpeechQueue();
  const idleTimer = createIdleTimer(config.idleAfterMs);
  const scheduler = createSegmentScheduler(plan);
  // Internal and external inputs share one lifecycle and one dispatch. The
  // idle timer goes first so it can be armed by anything a later source
  // emits while starting; the scheduler next, so the opening cue is spoken
  // before anything an external source emits while starting.
  const allSources: ShowEventSource<ShowEvent>[] = [
    idleTimer,
    scheduler,
    ...sources,
  ];

  let status: DirectorStatus = "ready";
  let errorMessage: string | null = null;
  let inFlight: Line | null = null;
  // Settles once the in-flight line's speak() has settled and been handled.
  let inFlightDone: Promise<void> = Promise.resolve();
  // Pending while a cut line is being stopped; nothing starts meanwhile.
  let cutting: Promise<void> | null = null;
  // The show finishes when this line settles, whatever its result.
  let endingLineId: string | null = null;
  // What a stop() called again, or after the show ended, resolves with.
  let stopping: Promise<void> = Promise.resolve();
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
      segment: scheduler.current()?.segment ?? null,
      ending: endingLineId !== null,
    };
  }

  function dispatch(event: ShowEvent): void {
    const now = Date.now();
    const decision = decide(event, view(now), config);
    log({ kind: "decision", at: now, event, decision });
    if (decision.kind === "ignore") {
      counters.eventsIgnored++;
    } else {
      applyDecisionEffects(event, decision, now);
      queue.push(Object.freeze(decision.line));
      // The urgent line is queued, not started: once the cut settles the
      // queue is drained by priority, so a queued cue still goes first. A
      // cut already settling serves this line too.
      if (decision.kind === "interrupt" && cutting === null) cut();
      drain();
    }
    publish();
  }

  // What accepting an event does besides queueing its line: the cooldown
  // and interrupt bookkeeping, and for a segment start, dropping queued idle
  // filler, logging the segment and remembering the ending line.
  function applyDecisionEffects(
    event: ShowEvent,
    decision: Exclude<Decision, { kind: "ignore" }>,
    now: number,
  ): void {
    nextLineNumber++;
    switch (event.kind) {
      case "chat":
        lastChatAt.set(event.viewer, now);
        break;
      case "agent":
        lastAgentAt.set(event.source, now);
        break;
      case "segment":
        // Filler was about the old segment; the new cue replaces it.
        queue.removeWhere((line) => line.source === "idle");
        log({
          kind: "segment",
          at: now,
          index: event.index,
          segment: event.segment,
        });
        if (event.segment.kind === "ending") endingLineId = decision.line.id;
        break;
    }
    if (decision.kind === "interrupt") {
      // Set at decision time so a second urgent event cannot cut the same
      // filler.
      lastInterruptAt = now;
    }
  }

  // Starts the next line if one can start now. Silence is judged here, after
  // the queue has been served, not from the queue's size when a line settled.
  function drain(): void {
    if (
      status !== "running" ||
      inFlight !== null ||
      startTimer !== null ||
      cutting !== null
    ) {
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
    inFlightDone = speaking.then(
      (result) => settle(line, result),
      (error: unknown) =>
        settle(line, { status: "failed", text: "", error: messageOf(error) }),
    );
  }

  // Stops the line in flight. Audio may overlap unless both port.interrupt()
  // and the cut line's speak() have settled, so the next line waits for both;
  // the cut line itself is not retried.
  function cut(): Promise<void> {
    const cutDone = inFlightDone;
    let interrupting: Promise<void>;
    try {
      interrupting = port.interrupt();
    } catch (error) {
      interrupting = Promise.reject(error);
    }
    cutting = interrupting.then(
      async () => {
        await cutDone;
        cutting = null;
        drain();
        publish();
      },
      (reason: unknown) => {
        cutting = null;
        // The audio may still be playing, so no other line may start, now or
        // when the cut line settles: the show fails without waiting for it.
        end("failed", messageOf(reason));
      },
    );
    return cutting;
  }

  function settle(line: Line, result: SpeakResult): void {
    inFlight = null;
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
    // A late settle is still recorded but never starts anything.
    if (status !== "running") {
      publish();
      return;
    }
    lastLineFailed = result.status === "failed";
    if (line.id === endingLineId) {
      end("finished");
      return;
    }
    drain();
    publish();
  }

  // The one way a show ends, whether finished, stopped or failed. A stop()
  // whose interrupt rejects calls it twice, `stopped` then `failed`, so the
  // teardown runs only the first time.
  function end(next: DirectorStatus, message?: string): void {
    const tearDown = status === "running";
    status = next;
    if (message !== undefined) {
      errorMessage = message;
      log({ kind: "error", at: Date.now(), message });
    }
    if (tearDown) {
      inFlight = null;
      queue.removeWhere(() => true);
      // Not a source, so stopping the sources would leave it pending.
      if (startTimer !== null) clearTimeout(startTimer);
      startTimer = null;
      for (const source of allSources) source.stop();
    }
    publish();
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function log(entry: DirectorLogEntry): void {
    unpublished.push(entry);
  }

  function buildSnapshot(): DirectorSnapshot {
    return Object.freeze({
      status,
      segmentIndex: scheduler.current()?.index ?? null,
      inFlight,
      queue: Object.freeze(queue.snapshot()),
      counters: Object.freeze({ ...counters }),
      error: errorMessage,
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
    let passes = 0;
    do {
      // A listener that pushes on every publish would otherwise loop forever
      // and freeze the caller. What is left goes out with the next publish.
      if (++passes > MAX_PUBLISH_PASSES) {
        // Kept current, though the listeners have not seen it.
        snapshot = buildSnapshot();
        queueMicrotask(() => {
          throw new Error(
            `Director: listeners kept publishing for ${MAX_PUBLISH_PASSES} passes`,
          );
        });
        break;
      }
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
      for (const source of allSources) {
        // A listener may stop the show while an earlier source starts; the
        // rest were stopped by end() already and must not start after it.
        if (status !== "running") break;
        source.start(dispatch);
      }
      drain();
      publish();
    },

    stop() {
      if (status !== "running") return stopping;
      // Taken before end() forgets the line in flight. A cut already
      // settling is awaited rather than interrupted a second time.
      const cutDone =
        cutting ?? (inFlight === null ? Promise.resolve() : cut());
      // Set before end(), whose publish may reach a listener calling stop().
      stopping = cutDone;
      end("stopped");
      return cutDone;
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
