import { CharivoError, CharivoStateError, toCharivoError } from "./errors";
import { createSentenceSegmenter } from "./sentence-segmenter";
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
  /** The line; for a stream, everything read from the iterator so far (S4). */
  text: string;
  /**
   * A stream's: the end of the last segment whose speech (its render, when
   * unvoiced) finished, so `heardText` is `text` up to it (S4). Unset for a
   * string.
   */
  heardEnd?: number;
  /**
   * A stream's, while its loop runs: abandons the pending read and closes the
   * iterator unless it ended by itself (S3). Called once, when it settles.
   */
  leave?: () => void;
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

/**
 * `heardText` of a performance that did not complete. A string's is `""`
 * while playback demonstrably has not begun, and omitted after (P6); a
 * stream's runs to the end of its last finished segment (S4).
 */
function heardSoFar(record: PerformanceRecord): { heardText?: string } {
  if (record.heardEnd !== undefined) {
    return { heardText: record.text.slice(0, record.heardEnd) };
  }
  return record.mayBeHeard ? {} : { heardText: "" };
}

/**
 * Calls the iterator's `return()` when present, without awaiting it and after
 * the floor change that left the stream, so it neither delays `done` nor runs
 * inside the call that cancelled. A failure only warns (S3).
 */
function closeIterator(iterator: AsyncIterator<string>): void {
  Promise.resolve()
    .then(() => iterator.return?.())
    .catch((error: unknown) => {
      console.warn("Failed to close the text stream:", error);
    });
}

/** What a stream's read resolves to once the stream was left. */
const LEFT = Symbol("left");

/** A line's failed step, for its run to end the performance with. */
interface StepFailure {
  failedAt: "render" | "tts";
  error: CharivoError;
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
  /** A realtime manager is attached and holds playback (R1). */
  private realtime = false;
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
    if (this.realtime) {
      return { state: "realtime" };
    }
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

    if (typeof text !== "string" && !isAsyncIterable(text)) {
      throw new CharivoStateError(
        "perform() takes a string or an async iterable of strings as text",
      );
    }

    if (this.realtime) {
      throw new CharivoStateError(
        "perform() was called while realtime holds playback",
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
      ...(typeof text === "string" ? { text } : { text: "", heardEnd: 0 }),
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
        ...(typeof text === "string" ? { text } : {}),
      });
      // The run begins only once its start has reached every listener and it
      // still holds the floor, so a start listener can cancel it first (P10).
      if (this.holder === record) {
        void (typeof text === "string"
          ? this.runString(record)
          : this.runStream(record, text));
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
   * R2: realtime may take playback only once the floor is free and every
   * manager with cancelled speech has confirmed its stop (P5). Throws before
   * anything changes, so `attachRealtime()` can check first.
   */
  assertRealtimeAdmissible(): void {
    if (this.holder) {
      throw new CharivoStateError(
        "attachRealtime() was called while a performance holds the floor",
      );
    }
    if (this.unsettled.size > 0) {
      // The stop that failed, when one has: the old voice may still be audible.
      const failure = [...this.unsettled.values()].find(
        (error) => error !== undefined,
      );
      throw new CharivoStateError(
        "attachRealtime() was called while cancelled speech has not been stopped; await interrupt() first",
        failure ? { cause: failure } : {},
      );
    }
  }

  /** Reserves playback for realtime, or frees it, reporting a change (R1, P8). */
  setRealtime(attached: boolean): void {
    if (this.realtime === attached) {
      return;
    }
    this.realtime = attached;
    this.produce("floor:changed", { floor: this.getFloor() });
    this.deliver();
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
    // P3: the render step, or its place, never begins inside perform().
    await Promise.resolve();
    if (this.holder !== record) {
      return;
    }

    await this.present(record, record.id, record.text, () =>
      this.finish(record, {
        status: "completed",
        text: record.text,
        heardText: record.text,
      }),
    );
  }

  /**
   * One loop (S2): read a chunk, then present each segment it completed
   * before the next read, so no text queues up behind the voice. Leaving the
   * floor abandons the read in progress and closes the iterator (S3).
   */
  private async runStream(
    record: PerformanceRecord,
    stream: AsyncIterable<string>,
  ): Promise<void> {
    // Nothing of the caller's iterable runs inside perform().
    await Promise.resolve();
    if (this.holder !== record) {
      return;
    }

    let iterator: AsyncIterator<string>;
    try {
      iterator = stream[Symbol.asyncIterator]();
    } catch (error) {
      this.failStream(record, error);
      return;
    }
    let open = true;
    let abandonRead: (() => void) | undefined;
    record.leave = () => {
      abandonRead?.();
      if (open) {
        closeIterator(iterator);
      }
    };

    const segmenter = createSentenceSegmenter();
    let index = 0;
    for (;;) {
      let step: IteratorResult<string> | typeof LEFT;
      try {
        step = await new Promise<IteratorResult<string> | typeof LEFT>(
          (resolve, reject) => {
            // Whatever an abandoned read later yields or rejects with settles
            // this promise no more (S3).
            abandonRead = () => resolve(LEFT);
            new Promise<IteratorResult<string>>((resolveRead) =>
              resolveRead(iterator.next()),
            ).then(resolve, reject);
          },
        );
      } catch (error) {
        open = false;
        this.failStream(record, error);
        return;
      }
      abandonRead = undefined;
      // A read can settle and the performance still lose the floor before
      // this continuation runs (P4).
      if (step === LEFT || this.holder !== record) {
        return;
      }

      let segments;
      if (step.done) {
        open = false;
        segments = segmenter.flush();
      } else {
        record.text += step.value;
        segments = segmenter.push(step.value);
      }

      for (const segment of segments) {
        this.produce("performance:segment", {
          performanceId: record.id,
          origin: record.origin,
          index,
          text: segment.text,
        });
        this.deliver();
        if (this.holder !== record) {
          return;
        }
        // A failure settles the performance, which leaves the stream: the
        // segments behind it are dropped and the iterator is closed (S5).
        await this.present(
          record,
          `${record.id}:${index}`,
          segment.text,
          () => {
            record.heardEnd = segment.end;
          },
        );
        if (this.holder !== record) {
          return;
        }
        index += 1;
      }

      if (step.done) {
        this.finish(record, {
          status: "completed",
          text: record.text,
          heardText: record.text,
        });
        return;
      }
    }
  }

  /**
   * Renders `content` as message `messageId`, resolves `started`, and speaks
   * it when voiced (P3), rechecking the floor after each step (P4). Its
   * outcome is applied in the tick the last step settles, so a cancel that
   * comes after never finds a presented line unheard: `presented` runs when
   * the line was presented, and a failed step ends the performance `failed`.
   */
  private async present(
    record: PerformanceRecord,
    messageId: string,
    content: string,
    presented: () => void,
  ): Promise<void> {
    const renderManager = this.host.getRenderManager();
    if (renderManager) {
      const character = this.host.getCharacter();
      const message: Message = {
        id: messageId,
        content,
        timestamp: new Date(),
        characterId: character?.id,
        type: "character",
      };

      try {
        await renderManager.render(message, character);
      } catch (error) {
        this.fail(record, {
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
        this.fail(record, {
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
      let speechFailure: CharivoError | undefined;
      try {
        await ttsManager.speak(content, voiceOptions(this.host.getCharacter()));
      } catch (error) {
        speechFailure = toCharivoError(
          "provider",
          error,
          "Failed to speak the line",
        );
      }
      record.speaking = false;
      // A stream speaks again on the next segment, with a watch of its own.
      record.unwatchAudio?.();
      record.unwatchAudio = undefined;
      if (speechFailure) {
        this.fail(record, { failedAt: "tts", error: speechFailure });
        return;
      }
      if (this.holder !== record) {
        return;
      }
    }
    presented();
  }

  /** A step failed: the holder ends `failed` at that step. */
  private fail(record: PerformanceRecord, failure: StepFailure): void {
    this.finish(record, {
      status: "failed",
      text: record.text,
      ...heardSoFar(record),
      ...failure,
    });
  }

  /** The stream's iterator failed: `failed` with no `failedAt` (S5). */
  private failStream(record: PerformanceRecord, error: unknown): void {
    this.finish(record, {
      status: "failed",
      text: record.text,
      ...heardSoFar(record),
      error: toCharivoError("provider", error, "The text stream failed"),
    });
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
      ...heardSoFar(record),
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
    const leave = record.leave;
    record.leave = undefined;
    leave?.();
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
