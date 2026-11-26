import { CharivoError, CharivoStateError, toCharivoError } from "./errors";
import type {
  Character,
  CharivoEventEmitter,
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
 * Speech cancelled on a manager that has not confirmed a stop since (P5). No
 * `speak()` is issued while any entry remains.
 */
interface UnsettledSpeech {
  /** The stop in progress on that manager; it never rejects. */
  stopping?: Promise<void>;
  /** Why the last stop on that manager failed. */
  error?: CharivoError;
}

/** The single holder of playback, and the runs of the performances it admits. */
export class Floor {
  private holder?: PerformanceRecord;
  private performanceSeq = 0;
  private readonly unsettled = new Map<TTSManager, UnsettledSpeech>();
  /**
   * Floor events not yet delivered (P10). Each entry emits one event, or
   * nothing when it no longer applies, at its turn.
   */
  private readonly deliveries: Array<() => void> = [];
  private delivering = false;

  constructor(
    private readonly emitter: CharivoEventEmitter,
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
      resolveStarted,
      resolveDone,
    };

    // The newcomer holds the floor before any event of the exchange is
    // delivered, and the exchange produces one floor:changed (P4).
    this.holder = record;
    if (displaced) {
      this.cancel(displaced);
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
    if (displaced?.speaking && displaced.ttsManager) {
      this.stopSpeech(displaced.ttsManager);
    }
    this.deliver();

    return {
      id: record.id,
      started,
      done,
      get result() {
        return record.result;
      },
      cancel: () =>
        Promise.reject(
          new CharivoStateError(
            "Cancelling a performance is not supported yet",
          ),
        ),
    };
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
        if (this.holder === record) {
          this.finish(record, {
            status: "failed",
            text,
            heardText: "",
            failedAt: "render",
            error: toCharivoError("state", error, "Failed to render the line"),
          });
        }
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
      const [stopFailure] = [...this.unsettled.values()];
      if (stopFailure) {
        // A stop that failed leaves the old voice possibly audible (P5).
        this.finish(record, {
          status: "failed",
          text,
          heardText: "",
          failedAt: "tts",
          error: stopFailure.error,
        });
        return;
      }

      record.speaking = true;
      try {
        await ttsManager.speak(text, voiceOptions(this.host.getCharacter()));
      } catch (error) {
        record.speaking = false;
        // `heardText` is omitted for now. Task 4 adds the P6 observation:
        // `""` when a manager that reports `tts:audio:start` never did.
        if (this.holder === record) {
          this.finish(record, {
            status: "failed",
            text,
            failedAt: "tts",
            error: toCharivoError(
              "provider",
              error,
              "Failed to speak the line",
            ),
          });
        }
        return;
      }
      record.speaking = false;
      if (this.holder !== record) {
        return;
      }
    }

    this.finish(record, { status: "completed", text, heardText: text });
  }

  /** Waits until no stop is in progress on any manager with unsettled speech. */
  private async settleStops(): Promise<void> {
    for (;;) {
      const stopping = [...this.unsettled.values()].flatMap((entry) =>
        entry.stopping ? [entry.stopping] : [],
      );
      if (stopping.length === 0) {
        return;
      }
      await Promise.all(stopping);
    }
  }

  /**
   * The logical half of P5 for a displaced holder. The caller has already
   * moved the floor, produces the floor:changed and issues the stop.
   */
  private cancel(record: PerformanceRecord): void {
    // `heardText` is `""` only before `speak()`; Task 4 adds the P6
    // observation of `tts:audio:start` on a manager that reports it.
    this.settle(record, {
      status: "cancelled",
      text: record.text,
      ...(record.speaking ? {} : { heardText: "" }),
    });
  }

  /** One stop on `manager`; its speech is unsettled until a stop succeeds (P5). */
  private stopSpeech(manager: TTSManager): void {
    const entry = this.unsettled.get(manager) ?? {};
    this.unsettled.set(manager, entry);
    if (entry.stopping) {
      return;
    }
    entry.stopping = new Promise<void>((resolve) =>
      resolve(manager.stop()),
    ).then(
      () => {
        this.unsettled.delete(manager);
      },
      (error: unknown) => {
        // Task 4 reports the rejection; the entry stays so no speech starts.
        entry.stopping = undefined;
        entry.error = toCharivoError(
          "provider",
          error,
          "Failed to stop the speech",
        );
      },
    );
  }

  /** The holder ended on its own: free the floor and report it (P2). */
  private finish(record: PerformanceRecord, result: PerformanceResult): void {
    this.holder = undefined;
    this.settle(record, result);
    this.produce("floor:changed", { floor: this.getFloor() });
    this.deliver();
  }

  /** Settles the handle and produces `performance:end` when a start was. */
  private settle(record: PerformanceRecord, result: PerformanceResult): void {
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
