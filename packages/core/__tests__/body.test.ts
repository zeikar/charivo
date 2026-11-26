import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Charivo,
  CharivoError,
  CharivoProviderError,
  CharivoStateError,
} from "@charivo/core";
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
    // Playback has begun, so the cancelled holder's heardText is unknown (P6).
    tts.startAudio();
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

describe("handle.cancel() (P5)", () => {
  it("ends the performance at once and resolves only after its stop settles", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachRenderer(new RecordingRenderManager());
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();
    const events = recordFloorEvents(charivo);

    let resolved = false;
    const cancelling = handle.cancel().then(() => {
      resolved = true;
    });

    expect(handle.result).toEqual({
      status: "cancelled",
      text: "Hello there.",
    });
    expect(charivo.getFloor()).toEqual({ state: "idle" });
    expect(eventIds(events)).toEqual([
      `performance:end:${handle.id}`,
      "floor:changed:idle",
    ]);
    expect(events[0]!.data).toEqual({
      performanceId: handle.id,
      origin: "app",
      status: "cancelled",
    });
    expect(tts.stop).toHaveBeenCalledTimes(1);
    await expect(handle.done).resolves.toBe(handle.result);

    await flush();
    expect(resolved).toBe(false);

    tts.stops[0]!.resolve();
    await cancelling;
    expect(resolved).toBe(true);
  });

  it("returns the first call's outcome from a repeated call and stops once", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    const first = handle.cancel();
    const second = handle.cancel();

    expect(second).toBe(first);
    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.resolve();
    await expect(second).resolves.toBeUndefined();
    expect(handle.cancel()).toBe(first);
  });

  it("resolves and stops nothing on a performance that ended on its own", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.finishSpeech(0);
    const result = await handle.done;
    const events = recordFloorEvents(charivo);

    await expect(handle.cancel()).resolves.toBeUndefined();

    expect(tts.stop).not.toHaveBeenCalled();
    expect(handle.result).toBe(result);
    expect(result.status).toBe("completed");
    expect(events).toEqual([]);
  });

  describe.each([
    ["with a render manager", true],
    ["without a render manager", false],
  ])("P3's recheck, %s", (_label, withRenderer) => {
    it("never calls speak() when a continuation attached to started cancels", async () => {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      if (withRenderer) {
        charivo.attachRenderer(new RecordingRenderManager());
      }
      charivo.attachTTS(tts);

      const handle = charivo.perform({ text: "Hello there." });
      let cancelling: Promise<void> | undefined;
      void handle.started.then(() => {
        cancelling = handle.cancel();
      });
      await flush();

      expect(cancelling).toBeDefined();
      await expect(cancelling).resolves.toBeUndefined();
      expect(tts.speak).not.toHaveBeenCalled();
      expect(tts.stop).not.toHaveBeenCalled();
      expect(handle.result).toEqual({
        status: "cancelled",
        text: "Hello there.",
        heardText: "",
      });
      expect(charivo.getFloor()).toEqual({ state: "idle" });
    });
  });
});

describe("a displaced performance's late settlement (P4)", () => {
  it("leaves the newcomer's floor alone when the cancelled speak() rejects afterwards", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const first = charivo.perform({ text: "First." });
    await flush();
    const second = charivo.perform({ text: "Second." });
    const events = recordFloorEvents(charivo);

    // A manager may reject the speak() its stop interrupted.
    tts.speaks[0]!.reject(new Error("interrupted"));
    await flush();

    expect(first.result).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: second.id,
      origin: "app",
    });
    expect(events).toEqual([]);
  });
});

describe("heardText of a cancelled or failed string (P6)", () => {
  it('is "" when cancelled before speak() was called', async () => {
    const charivo = new Charivo();
    const renderer = new RecordingRenderManager();
    renderer.holdNext();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(new SilentTTSManager());
    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    void handle.cancel();

    expect(handle.result).toEqual({
      status: "cancelled",
      text: "Hello there.",
      heardText: "",
    });
  });

  it('is "" on a reporting manager before tts:audio:start', async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    expect(tts.speak).toHaveBeenCalledTimes(1);

    void handle.cancel();

    expect(handle.result).toEqual({
      status: "cancelled",
      text: "Hello there.",
      heardText: "",
    });
  });

  it("is omitted on a reporting manager after tts:audio:start", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();

    void handle.cancel();

    expect(handle.result).toEqual({
      status: "cancelled",
      text: "Hello there.",
    });
  });

  it("is omitted on a manager without setEventEmitter once speak() was called", async () => {
    const charivo = new Charivo();
    const tts = new SilentTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    expect(tts.speak).toHaveBeenCalledTimes(1);

    void handle.cancel();

    expect(handle.result).toEqual({
      status: "cancelled",
      text: "Hello there.",
    });
  });

  it('is "" when a reporting manager rejects before audio starts', async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const events = recordFloorEvents(charivo);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    tts.speaks[0]!.reject(new Error("quota exceeded"));
    const result = await handle.done;

    expect(result).toEqual({
      status: "failed",
      text: "Hello there.",
      heardText: "",
      failedAt: "tts",
      error: expect.any(CharivoProviderError),
    });
    expect(events[2]!.data).toEqual({
      performanceId: handle.id,
      origin: "app",
      status: "failed",
      heardText: "",
      error: result.error,
    });
  });

  it("is omitted when a reporting manager rejects after audio started", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();

    tts.speaks[0]!.reject(new Error("playback failed"));

    await expect(handle.done).resolves.toEqual({
      status: "failed",
      text: "Hello there.",
      failedAt: "tts",
      error: expect.any(CharivoProviderError),
    });
  });
});

describe("speech that outlives its holder (P5)", () => {
  it("holds a newly attached manager's speak() until the old manager's stop succeeds", async () => {
    const charivo = new Charivo();
    const first = new ReportingTTSManager();
    const second = new ReportingTTSManager();
    charivo.attachTTS(first);
    const old = charivo.perform({ text: "First." });
    await flush();

    void old.cancel();
    charivo.attachTTS(second);
    const next = charivo.perform({ text: "Second." });
    await flush();

    await expect(next.started).resolves.toBe(true);
    expect(second.speak).not.toHaveBeenCalled();

    first.stops[0]!.resolve();
    await flush();

    expect(second.speak).toHaveBeenCalledWith("Second.", undefined);
    expect(second.stop).not.toHaveBeenCalled();
  });
});

describe("a rejected stop (P3, P5)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => {
    errorSpy?.mockRestore();
  });

  function spyOnConsoleError() {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    return errorSpy;
  }

  it("rejects cancel() with a typed error and logs nothing else", async () => {
    const consoleError = spyOnConsoleError();
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    const rejected = expect(handle.cancel()).rejects.toThrow(
      CharivoProviderError,
    );
    tts.stops[0]!.reject(new Error("device busy"));
    await rejected;
    await expect(handle.cancel()).rejects.toThrow("device busy");

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("fails the next perform() at tts with that error without speaking, before and after the old speak() settles", async () => {
    spyOnConsoleError();
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const old = charivo.perform({ text: "First." });
    await flush();

    const cancelling = old.cancel();
    const stopError = cancelling.catch((error: unknown) => error);
    const next = charivo.perform({ text: "Second." });
    await flush();
    tts.stops[0]!.reject(new Error("device busy"));
    const error = await stopError;

    expect(error).toBeInstanceOf(CharivoProviderError);
    await expect(next.done).resolves.toEqual({
      status: "failed",
      text: "Second.",
      heardText: "",
      failedAt: "tts",
      error,
    });
    await expect(next.started).resolves.toBe(true);

    // The cancelled speak() settling does not settle the speech.
    tts.speaks[0]!.resolve();
    await flush();
    const later = charivo.perform({ text: "Third." });

    await expect(later.done).resolves.toEqual({
      status: "failed",
      text: "Third.",
      heardText: "",
      failedAt: "tts",
      error,
    });
    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(tts.stop).toHaveBeenCalledTimes(1);
    expect(charivo.getFloor()).toEqual({ state: "idle" });
  });

  it("logs the rejection once with console.error when nothing waits on it", async () => {
    const consoleError = spyOnConsoleError();
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    charivo.perform({ text: "First." });
    await flush();
    const next = charivo.perform({ text: "Second." });

    tts.stops[0]!.reject(new Error("device busy"));
    const result = await next.done;
    await flush();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toContain(result.error);
    expect(result.error).toBeInstanceOf(CharivoProviderError);
    expect(result.error!.message).toBe("device busy");
  });
});

describe("cancel() after a logged stop failure (P5)", () => {
  it("rejects with the error console.error already reported", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      charivo.attachTTS(tts);
      const first = charivo.perform({ text: "First." });
      await flush();
      charivo.perform({ text: "Second." });

      tts.stops[0]!.reject(new Error("device busy"));
      await flush();
      expect(consoleError).toHaveBeenCalledTimes(1);
      const logged = consoleError.mock.calls[0]![1];
      expect(logged).toBeInstanceOf(CharivoProviderError);

      const error = await first
        .cancel()
        .catch((rejection: unknown) => rejection);

      expect(error).toBe(logged);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(tts.stop).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("Charivo.interrupt() on the floor (P7)", () => {
  it("stops the manager a voiced holder speaks on once, not one attached mid-performance", async () => {
    const charivo = new Charivo();
    const first = new ReportingTTSManager();
    const second = new ReportingTTSManager();
    charivo.attachTTS(first);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    charivo.attachTTS(second);

    let resolved = false;
    const interrupting = charivo.interrupt().then(() => {
      resolved = true;
    });

    expect(handle.result).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(charivo.getFloor()).toEqual({ state: "idle" });
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).not.toHaveBeenCalled();
    await flush();
    expect(resolved).toBe(false);

    first.stops[0]!.resolve();
    await interrupting;
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).not.toHaveBeenCalled();
  });

  it("cancels an unvoiced holder and stops a manager attached afterwards once", async () => {
    const charivo = new Charivo();
    const renderer = new RecordingRenderManager();
    renderer.holdNext();
    charivo.attachRenderer(renderer);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);

    const interrupting = charivo.interrupt();

    expect(handle.result).toEqual({
      status: "cancelled",
      text: "Hello there.",
      heardText: "",
    });
    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.resolve();
    await expect(interrupting).resolves.toBeUndefined();
    expect(tts.stop).toHaveBeenCalledTimes(1);
  });

  it("joins the stop cancel() started and issues none of its own", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    const cancelling = handle.cancel();
    let resolved = false;
    const interrupting = charivo.interrupt().then(() => {
      resolved = true;
    });
    await flush();

    expect(tts.stop).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    tts.stops[0]!.resolve();
    await interrupting;
    await expect(cancelling).resolves.toBeUndefined();
    expect(tts.stop).toHaveBeenCalledTimes(1);
  });

  it("rejects a joining interrupt() with the stop's error and logs nothing", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      charivo.attachTTS(tts);
      charivo.perform({ text: "First." });
      await flush();
      // A takeover's stop has no cancel() waiting on it.
      charivo.perform({ text: "Second." });

      const rejected = expect(charivo.interrupt()).rejects.toThrow(
        CharivoProviderError,
      );
      tts.stops[0]!.reject(new Error("device busy"));
      await rejected;

      expect(tts.stop).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("retries a rejected stop on that manager, and a retry that succeeds lets the next perform() speak", async () => {
    const charivo = new Charivo();
    const first = new ReportingTTSManager();
    const second = new ReportingTTSManager();
    charivo.attachTTS(first);
    const old = charivo.perform({ text: "First." });
    await flush();
    const rejected = expect(old.cancel()).rejects.toThrow("device busy");
    first.stops[0]!.reject(new Error("device busy"));
    await rejected;
    charivo.attachTTS(second);

    const interrupting = charivo.interrupt();

    expect(first.stop).toHaveBeenCalledTimes(2);
    // No holder supplied a stop, so the attached manager is stopped too.
    expect(second.stop).toHaveBeenCalledTimes(1);
    first.stops[1]!.resolve();
    second.stops[0]!.resolve();
    await expect(interrupting).resolves.toBeUndefined();

    const next = charivo.perform({ text: "Second." });
    await flush();
    expect(second.speak).toHaveBeenCalledWith("Second.", undefined);
    second.finishSpeech(0);
    await expect(next.done).resolves.toEqual(
      expect.objectContaining({ status: "completed" }),
    );
  });
});

describe("Charivo.dispose() and the floor (P9)", () => {
  it("settles the floor's performance cancelled and stops the attached manager once", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const events = recordFloorEvents(charivo);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    const disposing = charivo.dispose();
    await expect(handle.done).resolves.toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
    await flush();
    tts.stops[0]!.resolve();
    await expect(disposing).resolves.toBeUndefined();

    expect(tts.stop).toHaveBeenCalledTimes(1);
    expect(eventIds(events)).toEqual([
      `floor:changed:${handle.id}`,
      `performance:start:${handle.id}`,
      `performance:end:${handle.id}`,
      "floor:changed:idle",
    ]);
  });

  it("makes one stop attempt on a replaced manager with unsettled speech and rejects with its failure after the teardown", async () => {
    const charivo = new Charivo();
    const first = new ReportingTTSManager();
    const second = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(first);
    const old = charivo.perform({ text: "First." });
    await flush();
    const rejected = expect(old.cancel()).rejects.toThrow("device busy");
    first.stops[0]!.reject(new Error("device busy"));
    await rejected;
    charivo.attachTTS(second);

    const disposing = charivo.dispose();
    const failure = disposing.catch((error: unknown) => error);
    await flush();
    expect(first.stop).toHaveBeenCalledTimes(2);
    first.stops[1]!.reject(new Error("still stuck"));
    await flush();
    second.stops[0]!.resolve();

    const error = await failure;
    expect(error).toBeInstanceOf(CharivoError);
    expect((error as Error).message).toBe("still stuck");
    expect(first.stop).toHaveBeenCalledTimes(2);
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it("joins the stop cancel() started instead of stopping the manager again", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    const cancelling = handle.cancel();
    const disposing = charivo.dispose();
    await flush();

    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.resolve();
    await expect(cancelling).resolves.toBeUndefined();
    await expect(disposing).resolves.toBeUndefined();
    expect(tts.stop).toHaveBeenCalledTimes(1);
  });

  it("reports the attached manager's stop failure as a dispose error whichever stop failed", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    const cancelling = handle.cancel().catch(() => undefined);

    const failure = charivo.dispose().catch((error: unknown) => error);
    await flush();
    tts.stops[0]!.reject(new Error("device busy"));
    await cancelling;

    await expect(failure).resolves.toMatchObject({
      name: "CharivoDisposeError",
      cause: expect.objectContaining({ message: "device busy" }),
    });
  });

  it("speaks nothing for a perform() made from a listener while dispose() has yet to stop the cancelled speech", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "First." });
    await flush();
    let next: PerformanceHandle | undefined;
    charivo.on("performance:end", () => {
      next ??= charivo.perform({ text: "Second." });
    });

    const disposing = charivo.dispose();
    await flush();

    expect(handle.result).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(next).toBeDefined();
    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.resolve();
    await disposing;
    await expect(next!.done).resolves.toEqual(
      expect.objectContaining({ status: "failed", failedAt: "tts" }),
    );
    expect(tts.speak).toHaveBeenCalledTimes(1);
  });

  it("stops the attached manager once when interrupt() runs while dispose() has yet to stop it", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    charivo.perform({ text: "Hello there." });
    await flush();
    let interrupting: Promise<void> | undefined;
    charivo.on("performance:end", () => {
      interrupting ??= charivo.interrupt();
    });

    const disposing = charivo.dispose();
    await flush();

    expect(interrupting).toBeDefined();
    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.resolve();
    await expect(interrupting).resolves.toBeUndefined();
    await expect(disposing).resolves.toBeUndefined();
    expect(tts.stop).toHaveBeenCalledTimes(1);
  });
});

/**
 * An async iterable the test feeds chunk by chunk. Each `next()` stays pending
 * until the test feeds a chunk, ends the stream or rejects the read; feeding
 * with no read pending throws, so a test sees when the floor is not reading.
 */
class FedStream implements AsyncIterable<string> {
  nextCalls = 0;
  returnCalls = 0;
  private read?: Deferred<IteratorResult<string>>;
  private returnFailure?: unknown;

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        this.nextCalls += 1;
        this.read = deferred<IteratorResult<string>>();
        return this.read.promise;
      },
      return: () => {
        this.returnCalls += 1;
        return this.returnFailure === undefined
          ? Promise.resolve({ done: true, value: undefined })
          : Promise.reject(this.returnFailure);
      },
    };
  }

  push(chunk: string): void {
    this.takeRead().resolve({ done: false, value: chunk });
  }

  end(): void {
    this.takeRead().resolve({ done: true, value: undefined });
  }

  fail(error: unknown): void {
    this.takeRead().reject(error);
  }

  failReturn(error: unknown): void {
    this.returnFailure = error;
  }

  private takeRead(): Deferred<IteratorResult<string>> {
    const read = this.read;
    if (!read) {
      throw new Error("no next() call is pending");
    }
    this.read = undefined;
    return read;
  }
}

/** Collects unhandled rejections raised while it is installed. */
function watchUnhandledRejections() {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  return {
    unhandled,
    stop: () => process.off("unhandledRejection", unhandled),
  };
}

describe("Charivo.perform() for a text stream", () => {
  it("produces performance:start without text before reading any chunk", async () => {
    const charivo = new Charivo();
    charivo.attachTTS(new ReportingTTSManager());
    const events = recordFloorEvents(charivo);
    const stream = new FedStream();

    const handle = charivo.perform({ text: stream });

    expect(stream.nextCalls).toBe(0);
    expect(events.map(({ event }) => event)).toEqual([
      "floor:changed",
      "performance:start",
    ]);
    expect(events[1]!.data).toEqual({
      performanceId: handle.id,
      origin: "app",
      voiced: true,
    });
    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: handle.id,
      origin: "app",
    });
    await flush();
    expect(stream.nextCalls).toBe(1);
  });

  it("announces, renders and speaks each segment in order with a rising index, then completes", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);
    charivo.setCharacter(character);
    const events = recordFloorEvents(charivo);
    const steps: string[] = [];
    charivo.on("performance:segment", ({ index, text }) => {
      steps.push(`segment ${index} ${text}`);
    });
    renderer.render.mockImplementation((message) => {
      steps.push(`render ${message.id} ${message.content}`);
      return Promise.resolve();
    });
    tts.speak.mockImplementation((text) => {
      steps.push(`speak ${text}`);
      const call = deferred<void>();
      tts.speaks.push(call);
      return call.promise;
    });
    const stream = new FedStream();

    const handle = charivo.perform({ text: stream, origin: "cascade" });
    await flush();
    stream.push("Hello there. How");
    await flush();
    tts.speaks[0]!.resolve();
    await flush();
    stream.push(" are you? Bye");
    await flush();
    tts.speaks[1]!.resolve();
    await flush();
    stream.end();
    await flush();
    tts.speaks[2]!.resolve();
    const result = await handle.done;

    const id = handle.id;
    expect(steps).toEqual([
      "segment 0 Hello there.",
      `render ${id}:0 Hello there.`,
      "speak Hello there.",
      "segment 1 How are you?",
      `render ${id}:1 How are you?`,
      "speak How are you?",
      "segment 2 Bye",
      `render ${id}:2 Bye`,
      "speak Bye",
    ]);
    expect(renderer.render.mock.calls[0]![0]).toEqual({
      id: `${id}:0`,
      content: "Hello there.",
      timestamp: expect.any(Date),
      characterId: "hiyori",
      type: "character",
    });
    expect(renderer.render.mock.calls[0]![1]).toBe(character);
    expect(tts.speak).toHaveBeenCalledWith("Hello there.", {
      rate: 1.1,
      pitch: 0.9,
      volume: 0.8,
      voice: "alloy",
    });
    expect(
      events.find(({ event }) => event === "performance:segment")!.data,
    ).toEqual({
      performanceId: id,
      origin: "cascade",
      index: 0,
      text: "Hello there.",
    });
    expect(result).toEqual({
      status: "completed",
      text: "Hello there. How are you? Bye",
      heardText: "Hello there. How are you? Bye",
    });
    await expect(handle.started).resolves.toBe(true);
    expect(events.map(({ event }) => event)).toEqual([
      "floor:changed",
      "performance:start",
      "performance:segment",
      "performance:segment",
      "performance:segment",
      "performance:end",
      "floor:changed",
    ]);
    expect(events[5]!.data).toEqual({
      performanceId: id,
      origin: "cascade",
      status: "completed",
      heardText: "Hello there. How are you? Bye",
    });
    expect(charivo.getFloor()).toEqual({ state: "idle" });
    expect(stream.returnCalls).toBe(0);
  });

  it("reads no chunk while a segment is speaking", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const stream = new FedStream();

    charivo.perform({ text: stream });
    await flush();
    stream.push("One. Two. Three");
    await flush();

    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(stream.nextCalls).toBe(1);
    tts.speaks[0]!.resolve();
    await flush();
    expect(tts.speak).toHaveBeenCalledTimes(2);
    expect(stream.nextCalls).toBe(1);
    tts.speaks[1]!.resolve();
    await flush();
    expect(stream.nextCalls).toBe(2);
  });

  it("resolves started once the first segment has rendered", async () => {
    const charivo = new Charivo();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    const stream = new FedStream();
    const held = renderer.holdNext();
    let started: boolean | undefined;

    const handle = charivo.perform({ text: stream });
    void handle.started.then((value) => {
      started = value;
    });
    await flush();
    stream.push("Hello there. ");
    await flush();

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(started).toBeUndefined();
    held.resolve();
    await flush();
    expect(started).toBe(true);
  });

  it("completes an unvoiced stream after rendering each segment", async () => {
    const charivo = new Charivo();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    const events = recordFloorEvents(charivo);
    const stream = new FedStream();

    const handle = charivo.perform({ text: stream });
    await flush();
    stream.push("One. Two.");
    await flush();
    stream.end();
    const result = await handle.done;

    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(events[1]!.data).toEqual(expect.objectContaining({ voiced: false }));
    expect(result).toEqual({
      status: "completed",
      text: "One. Two.",
      heardText: "One. Two.",
    });
  });

  it.each([
    ["the empty stream", []],
    ["a stream with no speakable segment", ["... ", "\n"]],
  ])(
    "completes %s without a segment and with started false",
    async (_label, chunks) => {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      const renderer = new RecordingRenderManager();
      charivo.attachRenderer(renderer);
      charivo.attachTTS(tts);
      const events = recordFloorEvents(charivo);
      const stream = new FedStream();

      const handle = charivo.perform({ text: stream });
      for (const chunk of chunks) {
        await flush();
        stream.push(chunk);
      }
      await flush();
      stream.end();
      const result = await handle.done;

      const text = chunks.join("");
      expect(result).toEqual({ status: "completed", text, heardText: text });
      await expect(handle.started).resolves.toBe(false);
      expect(renderer.render).not.toHaveBeenCalled();
      expect(tts.speak).not.toHaveBeenCalled();
      expect(events.map(({ event }) => event)).toEqual([
        "floor:changed",
        "performance:start",
        "performance:end",
        "floor:changed",
      ]);
    },
  );
});

describe("leaving a text stream (S3, S4)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
  let rejections: ReturnType<typeof watchUnhandledRejections> | undefined;
  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = undefined;
    rejections?.stop();
    rejections = undefined;
  });

  const exits: Array<
    [string, (charivo: Charivo, handle: PerformanceHandle) => void]
  > = [
    ["cancel()", (_charivo, handle) => void handle.cancel()],
    ["a takeover", (charivo) => void charivo.perform({ text: "Next." })],
    ["interrupt()", (charivo) => void charivo.interrupt()],
  ];

  it.each(exits)(
    "settles done on %s during a pending read, frees the floor and calls return() once",
    async (_label, exit) => {
      const charivo = new Charivo();
      charivo.attachTTS(new ReportingTTSManager());
      const stream = new FedStream();

      const handle = charivo.perform({ text: stream });
      await flush();
      expect(stream.nextCalls).toBe(1);
      exit(charivo, handle);

      expect(handle.result).toEqual({
        status: "cancelled",
        text: "",
        heardText: "",
      });
      expect(charivo.getFloor()).not.toEqual(
        expect.objectContaining({ performanceId: handle.id }),
      );
      await expect(handle.done).resolves.toBe(handle.result);
      await flush();
      expect(stream.returnCalls).toBe(1);
      expect(stream.nextCalls).toBe(1);
    },
  );

  it.each([
    ["a chunk", (stream: FedStream) => stream.push("Late line. More. ")],
    ["a rejection", (stream: FedStream) => stream.fail(new Error("late"))],
  ])(
    "discards %s the abandoned read delivers afterwards",
    async (_label, deliver) => {
      rejections = watchUnhandledRejections();
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      const renderer = new RecordingRenderManager();
      charivo.attachRenderer(renderer);
      charivo.attachTTS(tts);
      const events = recordFloorEvents(charivo);
      const stream = new FedStream();

      const handle = charivo.perform({ text: stream });
      await flush();
      void handle.cancel();
      deliver(stream);
      await flush();

      expect(events.map(({ event }) => event)).not.toContain(
        "performance:segment",
      );
      expect(renderer.render).not.toHaveBeenCalled();
      expect(tts.speak).not.toHaveBeenCalled();
      expect(handle.result).toEqual(
        expect.objectContaining({ status: "cancelled", text: "" }),
      );
      expect(rejections.unhandled).not.toHaveBeenCalled();
    },
  );

  it("leaves a segment cancelled mid-speech out of heardText", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const stream = new FedStream();

    const handle = charivo.perform({ text: stream });
    await flush();
    stream.push("First. Second. ");
    await flush();
    tts.speaks[0]!.resolve();
    await flush();
    expect(tts.speak).toHaveBeenCalledTimes(2);
    const cancelling = handle.cancel();

    expect(handle.result).toEqual({
      status: "cancelled",
      text: "First. Second. ",
      heardText: "First.",
    });
    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.resolve();
    await cancelling;
    tts.speaks[1]!.resolve();
    await flush();
    expect(stream.returnCalls).toBe(1);
    expect(stream.nextCalls).toBe(1);
    expect(handle.result!.heardText).toBe("First.");
  });

  it("fails with the typed error and no failedAt when the iterator rejects, without calling return()", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const events = recordFloorEvents(charivo);
    const stream = new FedStream();

    const handle = charivo.perform({ text: stream });
    await flush();
    stream.push("Hello. ");
    await flush();
    tts.speaks[0]!.resolve();
    await flush();
    stream.fail(new Error("stream broke"));
    const result = await handle.done;
    await flush();

    expect(result).toEqual({
      status: "failed",
      text: "Hello. ",
      heardText: "Hello.",
      error: expect.any(CharivoError),
    });
    expect(result.error!.message).toContain("stream broke");
    expect(events.at(-2)!.data).toEqual({
      performanceId: handle.id,
      origin: "app",
      status: "failed",
      heardText: "Hello.",
      error: result.error,
    });
    expect(stream.returnCalls).toBe(0);
    expect(charivo.getFloor()).toEqual({ state: "idle" });
  });

  it("fails at tts on the second segment's speak() rejection, drops the rest and calls return() once", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const events = recordFloorEvents(charivo);
    const stream = new FedStream();

    const handle = charivo.perform({ text: stream });
    await flush();
    stream.push("One. Two. Three. ");
    await flush();
    tts.speaks[0]!.resolve();
    await flush();
    tts.speaks[1]!.reject(new Error("quota exceeded"));
    const result = await handle.done;
    await flush();

    expect(result).toEqual({
      status: "failed",
      text: "One. Two. Three. ",
      heardText: "One.",
      failedAt: "tts",
      error: expect.any(CharivoProviderError),
    });
    expect(tts.speak).toHaveBeenCalledTimes(2);
    expect(
      events.filter(({ event }) => event === "performance:segment"),
    ).toHaveLength(2);
    expect(stream.returnCalls).toBe(1);
    expect(stream.nextCalls).toBe(1);
  });

  it("fails at render on a segment's render failure, speaks nothing and calls return() once", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);
    const stream = new FedStream();
    renderer.failNext(new Error("canvas lost"));

    const handle = charivo.perform({ text: stream });
    await flush();
    stream.push("One. Two. ");
    const result = await handle.done;
    await flush();

    expect(result).toEqual({
      status: "failed",
      text: "One. Two. ",
      heardText: "",
      failedAt: "render",
      error: expect.any(CharivoError),
    });
    await expect(handle.started).resolves.toBe(false);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(tts.speak).not.toHaveBeenCalled();
    expect(stream.returnCalls).toBe(1);
  });

  it("reports a rejecting return() with console.warn and leaves done as it was", async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    rejections = watchUnhandledRejections();
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const stream = new FedStream();
    const closeFailure = new Error("close failed");
    stream.failReturn(closeFailure);

    const handle = charivo.perform({ text: stream });
    await flush();
    stream.push("One. Two. ");
    await flush();
    tts.speaks[0]!.reject(new Error("quota exceeded"));
    const result = await handle.done;
    await flush();

    expect(stream.returnCalls).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toContain(closeFailure);
    expect(handle.result).toBe(result);
    expect(result).toEqual(
      expect.objectContaining({ status: "failed", failedAt: "tts" }),
    );
    expect(result.error!.message).toContain("quota exceeded");
    expect(rejections.unhandled).not.toHaveBeenCalled();
  });
});

/** Runs `run` after `turns` further microtask turns. */
function afterMicrotasks(turns: number, run: () => void): void {
  if (turns === 0) {
    run();
  } else {
    queueMicrotask(() => afterMicrotasks(turns - 1, run));
  }
}

describe("a cancel just after speech settles (P2, P4, S4)", () => {
  it.each([1, 2, 3, 4])(
    "keeps a spoken segment heard and emits nothing after the end, cancelled %i microtasks after its speak() resolved",
    async (turns) => {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      charivo.attachTTS(tts);
      const events = recordFloorEvents(charivo);
      const stream = new FedStream();

      const handle = charivo.perform({ text: stream });
      await flush();
      stream.push("One. Two. ");
      await flush();
      tts.speaks[0]!.resolve();
      let readsAtCancel = 0;
      afterMicrotasks(turns, () => {
        readsAtCancel = stream.nextCalls;
        void handle.cancel();
      });
      await flush();

      expect(handle.result).toEqual({
        status: "cancelled",
        text: "One. Two. ",
        heardText: "One.",
      });
      const kinds = events.map(({ event }) => event);
      expect(kinds.slice(kinds.indexOf("performance:end"))).not.toContain(
        "performance:segment",
      );
      expect(stream.nextCalls).toBe(readsAtCancel);
    },
  );

  it.each([1, 2, 3, 4])(
    "reads no further chunk after a cancel %i microtasks after the last segment's speak() resolved",
    async (turns) => {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      charivo.attachTTS(tts);
      const stream = new FedStream();

      const handle = charivo.perform({ text: stream });
      await flush();
      stream.push("One. ");
      await flush();
      tts.speaks[0]!.resolve();
      let readsAtCancel = 0;
      afterMicrotasks(turns, () => {
        readsAtCancel = stream.nextCalls;
        void handle.cancel();
      });
      await flush();

      expect(handle.result).toEqual({
        status: "cancelled",
        text: "One. ",
        heardText: "One.",
      });
      expect(stream.nextCalls).toBe(readsAtCancel);
      expect(stream.returnCalls).toBe(1);
    },
  );

  it.each([1, 2, 3])(
    "completes a string whose speak() resolved %i microtasks before the cancel",
    async (turns) => {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      charivo.attachTTS(tts);

      const handle = charivo.perform({ text: "Hello there." });
      await flush();
      tts.speaks[0]!.resolve();
      let cancelling: Promise<void> | undefined;
      afterMicrotasks(turns, () => {
        cancelling = handle.cancel();
      });
      await flush();

      expect(handle.result).toEqual({
        status: "completed",
        text: "Hello there.",
        heardText: "Hello there.",
      });
      await expect(cancelling).resolves.toBeUndefined();
      expect(tts.stop).not.toHaveBeenCalled();
    },
  );
});

describe("a text stream's edges (S3, S5, P10)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
  let rejections: ReturnType<typeof watchUnhandledRejections> | undefined;
  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = undefined;
    rejections?.stop();
    rejections = undefined;
  });

  it.each([
    [
      "[Symbol.asyncIterator]()",
      (_returned: () => void): AsyncIterable<string> => ({
        [Symbol.asyncIterator]() {
          throw new Error("no iterator");
        },
      }),
    ],
    [
      "next()",
      (returned: () => void): AsyncIterable<string> => ({
        [Symbol.asyncIterator]: () => ({
          next() {
            throw new Error("no iterator");
          },
          return() {
            returned();
            return Promise.resolve({ done: true, value: undefined });
          },
        }),
      }),
    ],
  ])(
    "fails with no failedAt when %s throws synchronously",
    async (_label, makeStream) => {
      const returned = vi.fn();
      const charivo = new Charivo();
      charivo.attachTTS(new ReportingTTSManager());

      const handle = charivo.perform({ text: makeStream(returned) });
      const result = await handle.done;
      await flush();

      expect(result).toEqual({
        status: "failed",
        text: "",
        heardText: "",
        error: expect.any(CharivoError),
      });
      expect(result.error!.message).toContain("no iterator");
      expect(returned).not.toHaveBeenCalled();
      expect(charivo.getFloor()).toEqual({ state: "idle" });
    },
  );

  it("warns about a rejecting return() on cancel and leaves done cancelled", async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    rejections = watchUnhandledRejections();
    const charivo = new Charivo();
    charivo.attachTTS(new ReportingTTSManager());
    const stream = new FedStream();
    const closeFailure = new Error("close failed");
    stream.failReturn(closeFailure);

    const handle = charivo.perform({ text: stream });
    await flush();
    await handle.cancel();
    const result = handle.result;
    await flush();

    expect(stream.returnCalls).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toContain(closeFailure);
    expect(handle.result).toBe(result);
    expect(result).toEqual({ status: "cancelled", text: "", heardText: "" });
    await expect(handle.done).resolves.toBe(result);
    expect(rejections.unhandled).not.toHaveBeenCalled();
  });

  it("discards a chunk the abandoned read delivers after return() was called", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);
    const events = recordFloorEvents(charivo);
    const stream = new FedStream();

    const handle = charivo.perform({ text: stream });
    await flush();
    void handle.cancel();
    await flush();
    expect(stream.returnCalls).toBe(1);
    stream.push("Late line. More. ");
    await flush();

    expect(events.map(({ event }) => event)).not.toContain(
      "performance:segment",
    );
    expect(renderer.render).not.toHaveBeenCalled();
    expect(tts.speak).not.toHaveBeenCalled();
    expect(stream.nextCalls).toBe(1);
    expect(handle.result).toEqual({
      status: "cancelled",
      text: "",
      heardText: "",
    });
  });

  it("renders and speaks nothing of a segment its own performance:segment listener cancels", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const renderer = new RecordingRenderManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);
    const stream = new FedStream();
    const handle = charivo.perform({ text: stream });
    charivo.on("performance:segment", () => {
      void handle.cancel();
    });
    const events = recordFloorEvents(charivo);
    await flush();
    stream.push("One. Two. ");
    await flush();

    expect(eventIds(events)).toEqual([
      `performance:segment:${handle.id}`,
      `performance:end:${handle.id}`,
      "floor:changed:idle",
    ]);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(tts.speak).not.toHaveBeenCalled();
    expect(tts.stop).not.toHaveBeenCalled();
    expect(stream.returnCalls).toBe(1);
    expect(stream.nextCalls).toBe(1);
    expect(handle.result).toEqual({
      status: "cancelled",
      text: "One. Two. ",
      heardText: "",
    });
  });
});
