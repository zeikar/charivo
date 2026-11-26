import { CharivoError, CharivoStateError, toCharivoError } from "./errors";
import type {
  Character,
  CharivoEventBus,
  EventMap,
  FloorState,
  Message,
  PerformanceHandle,
  PerformanceResult,
  PerformRequest,
  RenderManager,
  TTSManager,
  TTSOptions,
} from "./types";

/**
 * What the floor reads from `Charivo`. Each is read at the moment the body
 * contract names, not captured up front, so a manager attached mid-performance
 * is the one the later step uses (except speech: see `PerformanceRecord`).
 */
export interface FloorHost {
  getRenderManager(): RenderManager | undefined;
  getTTSManager(): TTSManager | undefined;
  getCharacter(): Character | undefined;
}

interface PerformanceRecord {
  id: string;
  origin: string;
  text: string;
  /**
   * The manager attached when the floor was taken. It speaks the whole
   * performance even if another is attached meanwhile (P2).
   */
  ttsManager?: TTSManager;
  /** Its `performance:start` has begun delivery, so an end must follow (P2). */
  startDelivered: boolean;
  /** A `speak()` was issued and has not settled; cancelling it needs a stop (P5). */
  speaking: boolean;
  /**
   * Playback may have begun: `speak()` was called on a manager that cannot
   * report audio start, or a `tts:audio:start` was heard since it was called
   * on one that can. Until then `heardText` is `""` (P6).
   */
  mayBeHeard: boolean;
  /** Ends the `tts:audio:start` watch of a reporting manager's `speak()`. */
  unwatchAudio?: () => void;
  /** It was cancelled (P5), not ended on its own. */
  cancelled: boolean;
  /** The stop its cancellation issued or joined, when a `speak()` was in flight. */
  stop?: StopAttempt;
  /** What the first `handle.cancel()` returned; later calls return it too (P5). */
  cancelOutcome?: Promise<void>;
  result?: PerformanceResult;
  resolveStarted(started: boolean): void;
  resolveDone(result: PerformanceResult): void;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<string> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AsyncIterable<string>)[Symbol.asyncIterator] === "function"
  );
}

function voiceOptions(
  character: Character | undefined,
): TTSOptions | undefined {
  return character?.voice
    ? {
        rate: character.voice.rate,
        pitch: character.voice.pitch,
        volume: character.voice.volume,
        voice: character.voice.voiceId,
      }
    : undefined;
}

/** P6: `heardText: ""` while playback demonstrably has not begun. */
function heardIfSilent(record: PerformanceRecord): { heardText?: "" } {
  return record.mayBeHeard ? {} : { heardText: "" };
}

/** One `stop()` on a TTS manager. A manager never has two in progress (P7). */
interface StopAttempt {
  /** Resolves with the typed error when the stop rejected; never rejects. */
  settled: Promise<CharivoError | undefined>;
  /**
   * A `cancel()`, `interrupt()` or `dispose()` takes its outcome, so a
   * rejection is not logged as well (P5).
   */
  waited: boolean;
}

/** The single holder of playback, and the runs of the performances it admits. */
export class Floor {
  private holder?: PerformanceRecord;
  private performanceSeq = 0;
  /** The stop in progress on each manager. */
  private readonly stops = new Map<TTSManager, StopAttempt>();
  /**
   * Managers with cancelled speech that no stop has confirmed since (P5),
   * with the error of the last stop that failed (`undefined` while none has:
   * its stop is in progress, or, during `dispose()`, still to come). No
   * `speak()` is issued while any entry remains.
   */
  private readonly unsettled = new Map<TTSManager, CharivoError | undefined>();
  /**
   * Floor events not yet delivered (P10). Each entry emits one event, or
   * nothing when it no longer applies, at its turn.
   */
  private readonly deliveries: Array<() => void> = [];
  private delivering = false;

  constructor(
    private readonly emitter: CharivoEventBus,
    private readonly host: FloorHost,
  ) {}

  getFloor(): FloorState {
    return this.holder
      ? {
          state: "speaking",
          performanceId: this.holder.id,
          origin: this.holder.origin,
        }
      : { state: "idle" };
  }

  perform(request: PerformRequest): PerformanceHandle {
    const { text } = request;

    if (typeof text !== "string") {
      if (isAsyncIterable(text)) {
        throw new CharivoStateError(
          "perform() does not take a text stream yet",
        );
      }
      throw new CharivoStateError(
        "perform() takes a string or an async iterable of strings as text",
      );
    }

    const displaced = this.holder;
    if (displaced && request.whenBusy === "reject") {
      throw new CharivoStateError(
        "perform() was called while a performance holds the floor",
      );
    }

    let resolveStarted!: (started: boolean) => void;
    let resolveDone!: (result: PerformanceResult) => void;
    const started = new Promise<boolean>((resolve) => {
      resolveStarted = resolve;
    });
    const done = new Promise<PerformanceResult>((resolve) => {
      resolveDone = resolve;
    });

    this.performanceSeq += 1;
    const record: PerformanceRecord = {
      id: `performance-${Date.now()}-${this.performanceSeq}`,
      origin: request.origin ?? "app",
      text,
      ttsManager: this.host.getTTSManager(),
      startDelivered: false,
      speaking: false,
      mayBeHeard: false,
      cancelled: false,
      resolveStarted,
      resolveDone,
    };

    // The newcomer holds the floor before any event of the exchange is
    // delivered, and the exchange produces one floor:changed (P4).
    this.holder = record;
    if (displaced) {
      this.displace(displaced);
    }
    this.produce("floor:changed", { floor: this.getFloor() });
    this.deliveries.push(() => {
      // Displaced before its start was produced: neither start nor end (P4).
      if (this.holder !== record) {
        return;
      }
      record.startDelivered = true;
      this.emitter.emit("performance:start", {
        performanceId: record.id,
        origin: record.origin,
        voiced: record.ttsManager !== undefined,
        text,
      });
      // The run begins only once its start has reached every listener and it
      // still holds the floor, so a start listener can cancel it first (P10).
      if (this.holder === record) {
        void this.runString(record);
      }
    });
    // The stop comes after the exchange is produced, so a perform() reentering
    // from it is ordered after this one (P10).
    if (displaced) {
      this.stopCancelledSpeech(displaced);
    }
    this.deliver();

    return {
      id: record.id,
      started,
      done,
      get result() {
        return record.result;
      },
      cancel: () => (record.cancelOutcome ??= this.cancel(record)),
    };
  }

  /**
   * Speech only (P7): cancels the holder, retries the stop of unsettled speech
   * with none in progress and joins those in progress, and stops `fallback`
   * when cancelling the holder supplied no stop. Rejects with the error of the
   * first of those stops that failed.
   */
  interrupt(fallback: TTSManager | undefined): Promise<void> {
    const holder = this.holder;
    let supplied: StopAttempt | undefined;
    if (holder) {
      this.holder = undefined;
      this.displace(holder);
      this.produce("floor:changed", { floor: this.getFloor() });
      supplied = this.stopCancelledSpeech(holder);
    }

    const stops = new Set<StopAttempt>();
    if (supplied) {
      stops.add(supplied);
    }
    for (const manager of this.unsettled.keys()) {
      stops.add(this.stopManager(manager));
    }
    if (!supplied && fallback) {
      stops.add(this.stopManager(fallback));
    }
    this.deliver();

    return this.outcome([...stops]);
  }

  /**
   * The floor's part of `dispose()` before the teardown (P9): settles the
   * holder cancelled and makes one stop attempt, or joins the one in
   * progress, for each manager with unsettled speech other than `attached`,
   * whose stop is the teardown's own (`stop`). Resolves with the failures.
   */
  async dispose(attached: TTSManager | undefined): Promise<CharivoError[]> {
    const holder = this.holder;
    if (holder) {
      this.holder = undefined;
      this.displace(holder);
      if (holder.speaking && holder.ttsManager) {
        this.markUnsettled(holder.ttsManager);
      }
      this.produce("floor:changed", { floor: this.getFloor() });
      this.deliver();
    }

    const stops = [...this.unsettled.keys()]
      .filter((manager) => manager !== attached)
      .map((manager) => this.stopManager(manager));
    for (const stop of stops) {
      stop.waited = true;
    }
    const failures = await Promise.all(stops.map((stop) => stop.settled));
    return failures.filter((failure) => failure !== undefined);
  }

  /**
   * `dispose()`'s own stop of the attached manager (P9): joins the stop in
   * progress there or issues one, so the manager is stopped once, and its
   * success settles that manager's speech like any other stop.
   */
  stop(manager: TTSManager): Promise<void> {
    return this.outcome([this.stopManager(manager)]);
  }

  /** Forgets every stop and unsettled speech, once `dispose()` is done. */
  clear(): void {
    this.stops.clear();
    this.unsettled.clear();
  }

  private async runString(record: PerformanceRecord): Promise<void> {
    const { text } = record;

    // P3: the render step, or its place, never begins inside perform().
    await Promise.resolve();
    if (this.holder !== record) {
      return;
    }

    const renderManager = this.host.getRenderManager();
    if (renderManager) {
      const character = this.host.getCharacter();
      const message: Message = {
        id: record.id,
        content: text,
        timestamp: new Date(),
        characterId: character?.id,
        type: "character",
      };

      try {
        await renderManager.render(message, character);
      } catch (error) {
        this.finish(record, {
          status: "failed",
          text,
          heardText: "",
          failedAt: "render",
          error: toCharivoError("state", error, "Failed to render the line"),
        });
        return;
      }
      if (this.holder !== record) {
        return;
      }
    }

    record.resolveStarted(true);
    // One microtask turn, so a continuation the caller attached to `started`
    // on getting the handle runs before any speech step (P3).
    await Promise.resolve();
    if (this.holder !== record) {
      return;
    }

    const ttsManager = record.ttsManager;
    if (ttsManager) {
      await this.settleStops();
      if (this.holder !== record) {
        return;
      }
      // Every stop has settled, so what is still unsettled failed to stop and
      // the old voice may still be audible (P5), or awaits the stop
      // `dispose()` has yet to issue (P9).
      if (this.unsettled.size > 0) {
        this.finish(record, {
          status: "failed",
          text,
          heardText: "",
          failedAt: "tts",
          error:
            [...this.unsettled.values()].find(
              (failure) => failure !== undefined,
            ) ??
            new CharivoStateError("Cancelled speech has not been stopped yet"),
        });
        return;
      }

      record.speaking = true;
      this.watchAudio(record, ttsManager);
      try {
        await ttsManager.speak(text, voiceOptions(this.host.getCharacter()));
      } catch (error) {
        record.speaking = false;
        this.finish(record, {
          status: "failed",
          text,
          ...heardIfSilent(record),
          failedAt: "tts",
          error: toCharivoError("provider", error, "Failed to speak the line"),
        });
        return;
      }
      record.speaking = false;
      if (this.holder !== record) {
        return;
      }
    }

    this.finish(record, { status: "completed", text, heardText: text });
  }

  /** Waits until no stop is in progress on any manager. */
  private async settleStops(): Promise<void> {
    for (;;) {
      const stopping = [...this.stops.values()].map((stop) => stop.settled);
      if (stopping.length === 0) {
        return;
      }
      await Promise.all(stopping);
    }
  }

  /**
   * P6: a reporting manager's audio start, heard while its `speak()` is in
   * flight, means playback may have begun. A manager that cannot report it
   * may have begun as soon as it was asked.
   */
  private watchAudio(record: PerformanceRecord, manager: TTSManager): void {
    if (!manager.setEventEmitter) {
      record.mayBeHeard = true;
      return;
    }
    const onAudioStart = () => {
      record.mayBeHeard = true;
    };
    this.emitter.on("tts:audio:start", onAudioStart);
    record.unwatchAudio = () =>
      this.emitter.off("tts:audio:start", onAudioStart);
  }

  /** `handle.cancel()` (P5); `perform()` keeps the first call's outcome. */
  private cancel(record: PerformanceRecord): Promise<void> {
    if (record.cancelled) {
      return this.outcome(record.stop ? [record.stop] : []);
    }
    if (record.result) {
      // It ended on its own: nothing to stop.
      return Promise.resolve();
    }
    // Only the holder is still running.
    this.holder = undefined;
    this.displace(record);
    this.produce("floor:changed", { floor: this.getFloor() });
    const stop = this.stopCancelledSpeech(record);
    this.deliver();
    return this.outcome(stop ? [stop] : []);
  }

  /**
   * The logical half of P5. The caller has already moved the floor, produces
   * the floor:changed and supplies the stop (`stopCancelledSpeech`).
   */
  private displace(record: PerformanceRecord): void {
    record.cancelled = true;
    this.settle(record, {
      status: "cancelled",
      text: record.text,
      ...heardIfSilent(record),
    });
  }

  /**
   * The transport half of P5: one stop on the manager a cancelled `speak()`
   * is in flight on, after which that speech is unsettled until a stop on
   * that manager succeeds.
   */
  private stopCancelledSpeech(
    record: PerformanceRecord,
  ): StopAttempt | undefined {
    if (!record.speaking || !record.ttsManager) {
      return undefined;
    }
    this.markUnsettled(record.ttsManager);
    record.stop = this.stopManager(record.ttsManager);
    return record.stop;
  }

  private markUnsettled(manager: TTSManager): void {
    if (!this.unsettled.has(manager)) {
      this.unsettled.set(manager, undefined);
    }
  }

  /**
   * One stop on `manager`, or the one already in progress there. Success
   * settles that manager's speech; a rejection keeps it unsettled and is
   * logged when nothing takes its outcome (P5).
   */
  private stopManager(manager: TTSManager): StopAttempt {
    const inProgress = this.stops.get(manager);
    if (inProgress) {
      return inProgress;
    }
    const stop: StopAttempt = {
      waited: false,
      settled: new Promise<void>((resolve) => resolve(manager.stop())).then(
        () => {
          this.stops.delete(manager);
          this.unsettled.delete(manager);
          return undefined;
        },
        (error: unknown) => {
          this.stops.delete(manager);
          const failure = toCharivoError(
            "provider",
            error,
            "Failed to stop the speech",
          );
          if (this.unsettled.has(manager)) {
            this.unsettled.set(manager, failure);
          }
          if (!stop.waited) {
            console.error("Failed to stop cancelled speech:", failure);
          }
          return failure;
        },
      ),
    };
    this.stops.set(manager, stop);
    return stop;
  }

  /** Resolves once `stops` settle; rejects with the first one's failure. */
  private outcome(stops: StopAttempt[]): Promise<void> {
    for (const stop of stops) {
      stop.waited = true;
    }
    return Promise.all(stops.map((stop) => stop.settled)).then((failures) => {
      const failure = failures.find((error) => error !== undefined);
      if (failure) {
        throw failure;
      }
    });
  }

  /** The holder ended on its own: free the floor and report it (P2). */
  private finish(record: PerformanceRecord, result: PerformanceResult): void {
    // A performance that no longer holds the floor was settled when it lost
    // it, and must not free a newcomer's floor (P4).
    if (this.holder !== record) {
      return;
    }
    this.holder = undefined;
    this.settle(record, result);
    this.produce("floor:changed", { floor: this.getFloor() });
    this.deliver();
  }

  /** Settles the handle and produces `performance:end` when a start was. */
  private settle(record: PerformanceRecord, result: PerformanceResult): void {
    record.unwatchAudio?.();
    record.unwatchAudio = undefined;
    record.result = result;
    record.resolveStarted(false);
    record.resolveDone(result);

    if (!record.startDelivered) {
      return;
    }
    const { status, heardText, error } = result;
    this.produce("performance:end", {
      performanceId: record.id,
      origin: record.origin,
      status,
      ...(heardText !== undefined ? { heardText } : {}),
      ...(error ? { error } : {}),
    });
  }

  private produce<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.deliveries.push(() => this.emitter.emit(event, data));
  }

  /**
   * Delivers queued floor events one at a time in the order they were
   * produced. One produced from inside a listener waits until the dispatch in
   * progress has reached every listener (P10).
   */
  private deliver(): void {
    if (this.delivering) {
      return;
    }
    this.delivering = true;
    try {
      for (
        let next = this.deliveries.shift();
        next;
        next = this.deliveries.shift()
      ) {
        next();
      }
    } finally {
      this.delivering = false;
    }
  }
}
