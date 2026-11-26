import { describe, expect, it, vi } from "vitest";
import { Charivo, CharivoError, CharivoStateError } from "@charivo/core";
import type {
  Character,
  CharivoEventBus,
  CharivoEventEmitter,
  EventMap,
  FloorState,
  GazeCoordinates,
  Message,
  PerformanceHandle,
  RenderManager,
  TTSManager,
  TTSOptions,
} from "@charivo/core";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending microtask and timer callback run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Records `render` calls. A render resolves at once unless the next one was
 * held (`holdNext`) or set to fail (`failNext`).
 */
class RecordingRenderManager implements RenderManager {
  private nextRender?: Deferred<void>;
  private nextFailure?: unknown;

  render = vi.fn((_message: Message, _character?: Character) => {
    if (this.nextFailure !== undefined) {
      const failure = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.reject(failure);
    }
    if (this.nextRender) {
      const held = this.nextRender;
      this.nextRender = undefined;
      return held.promise;
    }
    return Promise.resolve();
  });
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  setCharacter = vi.fn((_character: Character) => undefined);
  setLocalGaze = vi.fn((_coords: GazeCoordinates) => false);
  setEventBus = vi.fn((_eventBus: CharivoEventBus) => undefined);
  disconnect = vi.fn(() => undefined);
  loadModel = vi.fn(async (_modelPath: string) => undefined);
  setMessageCallback = vi.fn(
    (_callback: (message: Message, character?: Character) => void) => undefined,
  );

  holdNext(): Deferred<void> {
    this.nextRender = deferred<void>();
    return this.nextRender;
  }

  failNext(error: unknown): void {
    this.nextFailure = error;
  }
}

/**
 * Its `speak` and `stop` calls stay pending until the test settles or
 * rejects them. It has no `setEventEmitter`, so it cannot report audio start.
 */
class SilentTTSManager implements TTSManager {
  readonly speaks: Deferred<void>[] = [];
  readonly stops: Deferred<void>[] = [];

  speak = vi.fn((_text: string, _options?: TTSOptions) => {
    const call = deferred<void>();
    this.speaks.push(call);
    return call.promise;
  });
  stop = vi.fn(() => {
    const call = deferred<void>();
    this.stops.push(call);
    return call.promise;
  });
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
}

/** A {@link SilentTTSManager} that reports audio start and end on its emitter. */
class ReportingTTSManager extends SilentTTSManager {
  private emitter?: CharivoEventEmitter;

  setEventEmitter = vi.fn((emitter: CharivoEventEmitter) => {
    this.emitter = emitter;
  });

  startAudio(): void {
    this.emitter?.emit("tts:audio:start", {});
  }

  /** Plays speech `index` to its end and settles its `speak()`. */
  finishSpeech(index: number): void {
    this.emitter?.emit("tts:audio:end", {});
    this.speaks[index]!.resolve();
  }
}

type RecordedEvent = {
  [K in keyof EventMap]: { event: K; data: EventMap[K] };
}[keyof EventMap];

const RECORDED_EVENTS = [
  "floor:changed",
  "performance:start",
  "performance:segment",
  "performance:end",
] as const;

function recordFloorEvents(charivo: Charivo): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  for (const event of RECORDED_EVENTS) {
    charivo.on(event, (data) => {
      events.push({ event, data } as RecordedEvent);
    });
  }
  return events;
}

const character: Character = {
  id: "hiyori",
  name: "Hiyori",
  voice: { voiceId: "alloy", rate: 1.1, pitch: 0.9, volume: 0.8 },
};

describe("Charivo.perform() for a string", () => {
  it("emits the floor and performance events in order around a voiced line", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachRenderer(new RecordingRenderManager());
    charivo.attachTTS(tts);
    charivo.setCharacter(character);
    const events = recordFloorEvents(charivo);

    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();
    tts.finishSpeech(0);
    await handle.done;

    expect(events.map(({ event }) => event)).toEqual([
      "floor:changed",
      "performance:start",
      "performance:end",
      "floor:changed",
    ]);
    expect(events[0]!.data).toEqual({
      floor: { state: "speaking", performanceId: handle.id, origin: "app" },
    });
    expect(events[1]!.data).toEqual(
      expect.objectContaining({
        performanceId: handle.id,
        origin: "app",
        voiced: true,
        text: "Hello there.",
      }),
    );
    expect(events[2]!.data).toEqual({
      performanceId: handle.id,
      origin: "app",
      status: "completed",
      heardText: "Hello there.",
    });
    expect(events[3]!.data).toEqual({ floor: { state: "idle" } });
  });

  it("renders the line as a character message whose id is the performance id", async () => {
    const charivo = new Charivo();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(new ReportingTTSManager());
    charivo.setCharacter(character);

    const handle = charivo.perform({ text: "Hello there.", origin: "cascade" });
    await flush();

    expect(renderer.render).toHaveBeenCalledTimes(1);
    const [message, renderedFor] = renderer.render.mock.calls[0]!;
    expect(message).toEqual({
      id: handle.id,
      content: "Hello there.",
      timestamp: expect.any(Date),
      characterId: "hiyori",
      type: "character",
    });
    expect(renderedFor).toBe(character);
  });

  it("speaks the line with the character's voice and completes when speech ends", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachRenderer(new RecordingRenderManager());
    charivo.attachTTS(tts);
    charivo.setCharacter(character);

    const handle = charivo.perform({ text: "Hello there." });

    expect(handle.result).toBeUndefined();
    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: handle.id,
      origin: "app",
    });

    await flush();

    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(tts.speak).toHaveBeenCalledWith("Hello there.", {
      rate: 1.1,
      pitch: 0.9,
      volume: 0.8,
      voice: "alloy",
    });
    await expect(handle.started).resolves.toBe(true);
    expect(handle.result).toBeUndefined();
    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: handle.id,
      origin: "app",
    });

    tts.startAudio();
    tts.finishSpeech(0);
    const result = await handle.done;

    expect(result).toEqual({
      status: "completed",
      text: "Hello there.",
      heardText: "Hello there.",
    });
    expect(handle.result).toEqual(result);
    expect(charivo.getFloor()).toEqual({ state: "idle" });
  });

  it("performs the empty string as given", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);

    const handle = charivo.perform({ text: "" });
    await flush();
    expect(tts.speak).toHaveBeenCalledWith("", undefined);
    tts.finishSpeech(0);

    await expect(handle.done).resolves.toEqual({
      status: "completed",
      text: "",
      heardText: "",
    });
  });

  describe.each([
    ["with a render manager", true],
    ["without a render manager", false],
  ])("the order P3 fixes, %s", (_label, withRenderer) => {
    it("runs a continuation attached to started before speak() is called", async () => {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      const renderer = new RecordingRenderManager();
      if (withRenderer) {
        charivo.attachRenderer(renderer);
      }
      charivo.attachTTS(tts);

      const handle = charivo.perform({ text: "Hello there." });
      expect(renderer.render).not.toHaveBeenCalled();

      let speaksSeenByContinuation: number | undefined;
      void handle.started.then(() => {
        speaksSeenByContinuation = tts.speak.mock.calls.length;
      });
      await flush();

      expect(speaksSeenByContinuation).toBe(0);
      expect(tts.speak).toHaveBeenCalledTimes(1);
    });
  });

  it("completes after the render when no TTS manager is attached", async () => {
    const charivo = new Charivo();
    const renderer = new RecordingRenderManager();
    const held = renderer.holdNext();
    charivo.attachRenderer(renderer);
    const events = recordFloorEvents(charivo);

    const handle = charivo.perform({ text: "Hello there." });
    let settled = false;
    void handle.done.then(() => {
      settled = true;
    });
    await flush();

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    held.resolve();
    await expect(handle.done).resolves.toEqual({
      status: "completed",
      text: "Hello there.",
      heardText: "Hello there.",
    });
    await expect(handle.started).resolves.toBe(true);
    expect(events[1]!.data).toEqual(expect.objectContaining({ voiced: false }));
    expect(charivo.getFloor()).toEqual({ state: "idle" });
  });

  it("speaks on the manager attached when the floor was taken", async () => {
    const charivo = new Charivo();
    const first = new ReportingTTSManager();
    const second = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    const held = renderer.holdNext();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(first);

    charivo.perform({ text: "Hello there." });
    charivo.attachTTS(second);
    held.resolve();
    await flush();

    expect(first.speak).toHaveBeenCalledTimes(1);
    expect(second.speak).not.toHaveBeenCalled();
  });

  it("speaks and completes when no render manager is attached", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);

    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    expect(tts.speak).toHaveBeenCalledWith("Hello there.", undefined);
    await expect(handle.started).resolves.toBe(true);

    tts.finishSpeech(0);
    await expect(handle.done).resolves.toEqual({
      status: "completed",
      text: "Hello there.",
      heardText: "Hello there.",
    });
  });

  it("ends failed at render, speaks nothing and never starts on a render failure", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    renderer.failNext(new Error("canvas lost"));
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);
    const events = recordFloorEvents(charivo);

    const handle = charivo.perform({ text: "Hello there." });
    const result = await handle.done;
    await flush();

    expect(result).toEqual({
      status: "failed",
      text: "Hello there.",
      heardText: "",
      failedAt: "render",
      error: expect.any(CharivoError),
    });
    expect(handle.result).toBe(result);
    await expect(handle.started).resolves.toBe(false);
    expect(tts.speak).not.toHaveBeenCalled();
    expect(events.map(({ event }) => event)).toEqual([
      "floor:changed",
      "performance:start",
      "performance:end",
      "floor:changed",
    ]);
    expect(events[2]!.data).toEqual({
      performanceId: handle.id,
      origin: "app",
      status: "failed",
      heardText: "",
      error: result.error,
    });
    expect(charivo.getFloor()).toEqual({ state: "idle" });
  });

  it("ends failed at tts with a typed error when speak() rejects", async () => {
    const charivo = new Charivo();
    const tts = new SilentTTSManager();
    charivo.attachTTS(tts);
    const events = recordFloorEvents(charivo);

    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.speaks[0]!.reject(new Error("quota exceeded"));
    const result = await handle.done;

    expect(result).toEqual({
      status: "failed",
      text: "Hello there.",
      failedAt: "tts",
      error: expect.any(CharivoError),
    });
    expect(result.error!.message).toContain("quota exceeded");
    await expect(handle.started).resolves.toBe(true);
    expect(events[2]!.data).toEqual({
      performanceId: handle.id,
      origin: "app",
      status: "failed",
      error: result.error,
    });
    expect(charivo.getFloor()).toEqual({ state: "idle" });
  });

  it.each([
    ["a number", 42],
    ["undefined", undefined],
    ["a sync iterable", ["Hello", "there."]],
  ])(
    "throws CharivoStateError for %s as text and takes no floor",
    (_label, text) => {
      const charivo = new Charivo();
      const events = recordFloorEvents(charivo);

      expect(() =>
        charivo.perform({ text: text as unknown as string }),
      ).toThrow(CharivoStateError);
      expect(events).toEqual([]);
      expect(charivo.getFloor()).toEqual({ state: "idle" });
    },
  );
});

/** Asserts every recorded `performance:start` is followed by exactly one `performance:end`, and no end comes without a start. */
function expectEachStartEndedOnce(events: RecordedEvent[]): void {
  const starts: string[] = [];
  const ends: string[] = [];
  for (const { event, data } of events) {
    if (event === "performance:start") {
      expect(starts).not.toContain(data.performanceId);
      starts.push(data.performanceId);
    } else if (event === "performance:end") {
      expect(starts).toContain(data.performanceId);
      expect(ends).not.toContain(data.performanceId);
      ends.push(data.performanceId);
    }
  }
  expect([...ends].sort()).toEqual([...starts].sort());
}

function eventIds(events: RecordedEvent[]): string[] {
  return events.map((recorded) => {
    if (recorded.event === "floor:changed") {
      const { floor } = recorded.data;
      return `${recorded.event}:${floor.state === "speaking" ? floor.performanceId : floor.state}`;
    }
    // The recorder takes floor:changed and the performance:* events only.
    const { performanceId } = recorded.data as { performanceId: string };
    return `${recorded.event}:${performanceId}`;
  });
}

describe("whenBusy and takeover", () => {
  it('throws for whenBusy "reject" and leaves the holder running', async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);

    const first = charivo.perform({ text: "First." });
    await flush();
    const events = recordFloorEvents(charivo);

    expect(() =>
      charivo.perform({ text: "Second.", whenBusy: "reject" }),
    ).toThrow(CharivoStateError);
    expect(events).toEqual([]);
    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: first.id,
      origin: "app",
    });
    expect(tts.stop).not.toHaveBeenCalled();

    tts.finishSpeech(0);
    await expect(first.done).resolves.toEqual({
      status: "completed",
      text: "First.",
      heardText: "First.",
    });
    expect(tts.speak).toHaveBeenCalledTimes(1);
  });

  it("ends the holder cancelled with one floor:changed and one stop() on its manager", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachRenderer(new RecordingRenderManager());
    charivo.attachTTS(tts);

    const first = charivo.perform({ text: "First." });
    await flush();
    expect(tts.speak).toHaveBeenCalledTimes(1);
    const events = recordFloorEvents(charivo);

    const second = charivo.perform({ text: "Second." });

    expect(first.result).toEqual({ status: "cancelled", text: "First." });
    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: second.id,
      origin: "app",
    });
    expect(eventIds(events)).toEqual([
      `performance:end:${first.id}`,
      `floor:changed:${second.id}`,
      `performance:start:${second.id}`,
    ]);
    expect(events[0]!.data).toEqual({
      performanceId: first.id,
      origin: "app",
      status: "cancelled",
    });
    expect(tts.stop).toHaveBeenCalledTimes(1);
    await expect(first.started).resolves.toBe(true);
    await expect(first.done).resolves.toBe(first.result);

    // The cancelled speak() settling ends nothing further for the holder.
    tts.speaks[0]!.resolve();
    tts.stops[0]!.resolve();
    await flush();
    expect(tts.stop).toHaveBeenCalledTimes(1);
    expect(eventIds(events).filter((id) => id.includes(first.id))).toEqual([
      `performance:end:${first.id}`,
    ]);
  });

  it("does not call the newcomer's speak() until the holder's stop has succeeded", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);

    charivo.perform({ text: "First." });
    await flush();
    const second = charivo.perform({ text: "Second." });
    await flush();

    expect(renderer.render).toHaveBeenCalledTimes(2);
    await expect(second.started).resolves.toBe(true);
    expect(tts.speak).toHaveBeenCalledTimes(1);

    tts.stops[0]!.resolve();
    await flush();

    expect(tts.speak).toHaveBeenCalledTimes(2);
    expect(tts.speak).toHaveBeenLastCalledWith("Second.", undefined);
    tts.finishSpeech(1);
    await expect(second.done).resolves.toEqual({
      status: "completed",
      text: "Second.",
      heardText: "Second.",
    });
    expect(tts.stop).toHaveBeenCalledTimes(1);
  });

  it("stops nothing for a holder cancelled before its speak()", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    const held = renderer.holdNext();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);

    const first = charivo.perform({ text: "First." });
    await flush();
    expect(renderer.render).toHaveBeenCalledTimes(1);

    const second = charivo.perform({ text: "Second." });
    await expect(first.done).resolves.toEqual({
      status: "cancelled",
      text: "First.",
      heardText: "",
    });
    await expect(first.started).resolves.toBe(false);

    held.resolve();
    await flush();

    expect(tts.stop).not.toHaveBeenCalled();
    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(tts.speak).toHaveBeenCalledWith("Second.", undefined);
    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: second.id,
      origin: "app",
    });
  });
});

describe("perform() from a floor event listener (P4)", () => {
  function setUp() {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);
    return { charivo, tts, renderer };
  }

  it("lets a perform() from a performance:end listener win", async () => {
    const { charivo, tts } = setUp();
    const events = recordFloorEvents(charivo);
    let second: PerformanceHandle | undefined;
    const first = charivo.perform({ text: "First." });
    charivo.on("performance:end", ({ performanceId }) => {
      if (performanceId === first.id) {
        second = charivo.perform({ text: "Second." });
      }
    });

    await flush();
    tts.finishSpeech(0);
    await first.done;
    await flush();

    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: second!.id,
      origin: "app",
    });
    expect(tts.speak).toHaveBeenLastCalledWith("Second.", undefined);
    tts.finishSpeech(1);
    await expect(second!.done).resolves.toEqual(
      expect.objectContaining({ status: "completed" }),
    );
    expect(eventIds(events)).toEqual([
      `floor:changed:${first.id}`,
      `performance:start:${first.id}`,
      `performance:end:${first.id}`,
      "floor:changed:idle",
      `floor:changed:${second!.id}`,
      `performance:start:${second!.id}`,
      `performance:end:${second!.id}`,
      "floor:changed:idle",
    ]);
    expectEachStartEndedOnce(events);
  });

  it("lets a perform() from a floor:changed listener win over a performance displaced before its start", async () => {
    const { charivo, tts, renderer } = setUp();
    const events = recordFloorEvents(charivo);
    let firstId: string | undefined;
    let second: PerformanceHandle | undefined;
    charivo.on("floor:changed", ({ floor }) => {
      if (!second && floor.state === "speaking") {
        firstId = floor.performanceId;
        second = charivo.perform({ text: "Second." });
      }
    });

    const first = charivo.perform({ text: "First." });

    expect(first.id).toBe(firstId);
    expect(first.result).toEqual({
      status: "cancelled",
      text: "First.",
      heardText: "",
    });
    await expect(first.started).resolves.toBe(false);
    expect(eventIds(events)).toEqual([
      `floor:changed:${first.id}`,
      `floor:changed:${second!.id}`,
      `performance:start:${second!.id}`,
    ]);

    await flush();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render.mock.calls[0]![0].id).toBe(second!.id);
    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(tts.speak).toHaveBeenCalledWith("Second.", undefined);
    expect(tts.stop).not.toHaveBeenCalled();
    tts.finishSpeech(0);
    await second!.done;
    expectEachStartEndedOnce(events);
  });

  it("lets a perform() from a performance:start listener win", async () => {
    const { charivo, tts, renderer } = setUp();
    const events = recordFloorEvents(charivo);
    let second: PerformanceHandle | undefined;
    charivo.on("performance:start", () => {
      if (!second) {
        second = charivo.perform({ text: "Second." });
      }
    });

    const first = charivo.perform({ text: "First." });

    expect(first.result).toEqual({
      status: "cancelled",
      text: "First.",
      heardText: "",
    });
    expect(eventIds(events)).toEqual([
      `floor:changed:${first.id}`,
      `performance:start:${first.id}`,
      `performance:end:${first.id}`,
      `floor:changed:${second!.id}`,
      `performance:start:${second!.id}`,
    ]);

    await flush();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render.mock.calls[0]![0].id).toBe(second!.id);
    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(tts.speak).toHaveBeenCalledWith("Second.", undefined);
    tts.finishSpeech(0);
    await second!.done;
    expect(charivo.getFloor()).toEqual({ state: "idle" });
    expectEachStartEndedOnce(events);
  });
});

describe("ordered delivery of floor events (P10)", () => {
  it("delivers floor values in transition order to a subscriber after a floor:changed listener that performs", () => {
    const charivo = new Charivo();
    charivo.attachTTS(new ReportingTTSManager());
    let performed = false;
    charivo.on("floor:changed", () => {
      if (!performed) {
        performed = true;
        charivo.perform({ text: "Second." });
      }
    });
    const seen: FloorState[] = [];
    charivo.on("floor:changed", ({ floor }) => {
      seen.push(floor);
    });

    const first = charivo.perform({ text: "First." });

    const second = charivo.getFloor();
    expect(second).toEqual(expect.objectContaining({ state: "speaking" }));
    expect(seen).toEqual([
      { state: "speaking", performanceId: first.id, origin: "app" },
      second,
    ]);
    expect(seen.at(-1)).toEqual(charivo.getFloor());
  });

  it("delivers the first performance's start before its end to a subscriber after a performance:start listener that performs", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    let second: PerformanceHandle | undefined;
    charivo.on("performance:start", () => {
      if (!second) {
        second = charivo.perform({ text: "Second." });
      }
    });
    const events = recordFloorEvents(charivo);

    const first = charivo.perform({ text: "First." });

    const ids = eventIds(events);
    expect(ids.indexOf(`performance:start:${first.id}`)).toBeGreaterThan(-1);
    expect(ids.indexOf(`performance:start:${first.id}`)).toBeLessThan(
      ids.indexOf(`performance:end:${first.id}`),
    );
    const floors = events.flatMap(({ event, data }) =>
      event === "floor:changed" ? [data.floor] : [],
    );
    expect(floors.at(-1)).toEqual(charivo.getFloor());

    await flush();
    tts.finishSpeech(0);
    await second!.done;
    expectEachStartEndedOnce(events);
  });

  it("never renders or speaks a performance its own start listener cancels, and delivers its start and end", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);
    const events = recordFloorEvents(charivo);
    let gated: PerformanceHandle | undefined;
    let third: PerformanceHandle | undefined;
    charivo.on("floor:changed", () => {
      if (!gated) {
        gated = charivo.perform({ text: "Gated." });
      }
    });
    charivo.on("performance:start", ({ performanceId }) => {
      if (gated && performanceId === gated.id) {
        // A takeover is the cancellation available on the floor so far.
        third = charivo.perform({ text: "Third." });
      }
    });

    charivo.perform({ text: "First." });
    await flush();

    expect(gated!.result).toEqual({
      status: "cancelled",
      text: "Gated.",
      heardText: "",
    });
    const ids = eventIds(events);
    expect(ids).toContain(`performance:start:${gated!.id}`);
    expect(ids).toContain(`performance:end:${gated!.id}`);
    expect(
      events.find(
        ({ event, data }) =>
          event === "performance:end" && data.performanceId === gated!.id,
      )!.data,
    ).toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(renderer.render.mock.calls.map(([message]) => message.id)).toEqual([
      third!.id,
    ]);
    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(tts.speak).toHaveBeenCalledWith("Third.", undefined);
    tts.finishSpeech(0);
    await third!.done;
    expectEachStartEndedOnce(events);
  });
});
