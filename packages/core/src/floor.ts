import { CharivoStateError, toCharivoError } from "./errors";
import type {
  Character,
  CharivoEventEmitter,
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

/** The single holder of playback, and the runs of the performances it admits. */
export class Floor {
  private holder?: PerformanceRecord;
  private performanceSeq = 0;

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

    if (this.holder) {
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
      resolveStarted,
      resolveDone,
    };

    this.holder = record;
    this.emitter.emit("floor:changed", { floor: this.getFloor() });
    this.emitter.emit("performance:start", {
      performanceId: record.id,
      origin: record.origin,
      voiced: record.ttsManager !== undefined,
      text,
    });

    void this.runString(record);

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
        this.end(record, {
          status: "failed",
          text,
          heardText: "",
          failedAt: "render",
          error: toCharivoError("state", error, "Failed to render the line"),
        });
        return;
      }
    }

    record.resolveStarted(true);
    // One microtask turn, so a continuation the caller attached to `started`
    // on getting the handle runs before any speech step (P3).
    await Promise.resolve();

    const ttsManager = record.ttsManager;
    if (ttsManager) {
      try {
        await ttsManager.speak(text, voiceOptions(this.host.getCharacter()));
      } catch (error) {
        // `heardText` is omitted for now. Task 4 adds the P6 observation:
        // `""` when a manager that reports `tts:audio:start` never did.
        this.end(record, {
          status: "failed",
          text,
          failedAt: "tts",
          error: toCharivoError("provider", error, "Failed to speak the line"),
        });
        return;
      }
    }

    this.end(record, { status: "completed", text, heardText: text });
  }

  private end(record: PerformanceRecord, result: PerformanceResult): void {
    record.result = result;
    if (this.holder === record) {
      this.holder = undefined;
    }
    record.resolveStarted(false);
    record.resolveDone(result);

    const { status, heardText, error } = result;
    this.emitter.emit("performance:end", {
      performanceId: record.id,
      origin: record.origin,
      status,
      ...(heardText !== undefined ? { heardText } : {}),
      ...(error ? { error } : {}),
    });
    this.emitter.emit("floor:changed", { floor: this.getFloor() });
  }
}
