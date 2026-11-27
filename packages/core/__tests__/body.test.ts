import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Charivo,
  CharivoError,
  CharivoProviderError,
  CharivoStateError,
  createCharivo,
} from "@charivo/core";
import { createRenderManager } from "@charivo/render";
import type {
  AffectMap,
  BrainInput,
  BrainTurn,
  BrainTurnResult,
  Character,
  CharacterBody,
  CharivoEventBus,
  CharivoEventEmitter,
  ConversationBrain,
  EventMap,
  FloorState,
  GazeCoordinates,
  Message,
  PerformanceHandle,
  RealtimeManager,
  RealtimeState,
  Renderer,
  RenderManager,
  ToolDefinition,
  ToolRegistration,
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

  it("is omitted when a tts:audio:start listener cancels from inside the event", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    // Registered before the floor's own watch, which begins at speak().
    let cancel: () => void = () => {};
    charivo.on("tts:audio:start", () => cancel());
    const handle = charivo.perform({ text: "Hello there." });
    cancel = () => void handle.cancel();
    await flush();

    tts.startAudio();

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

  it("joins the stop in progress when a listener interrupts from inside the manager's stop()", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    charivo.perform({ text: "Hello there." });
    await flush();
    let reentered: Promise<void> | undefined;
    charivo.on("tts:audio:end", () => {
      reentered ??= charivo.interrupt();
    });
    const originalStop = tts.stop.getMockImplementation()!;
    tts.stop.mockImplementation(() => {
      tts.startAudio();
      charivo.emit("tts:audio:end", {});
      return originalStop();
    });

    const interrupting = charivo.interrupt();
    let reenteredDone = false;
    void reentered!.then(() => {
      reenteredDone = true;
    });
    await flush();

    expect(tts.stop).toHaveBeenCalledTimes(1);
    expect(reenteredDone).toBe(false);
    expect(() => charivo.attachRealtime(new StubRealtimeManager())).toThrow(
      CharivoStateError,
    );

    tts.stops[0]!.resolve();
    await interrupting;
    await reentered;
    expect(tts.stop).toHaveBeenCalledTimes(1);
  });

  it("gives a handle.cancel() from inside the manager's stop() the outcome of that stop", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    let reentered: Promise<void> | undefined;
    charivo.on("tts:audio:end", () => {
      reentered ??= handle.cancel();
    });
    const originalStop = tts.stop.getMockImplementation()!;
    tts.stop.mockImplementation(() => {
      charivo.emit("tts:audio:end", {});
      return originalStop();
    });

    const interrupting = charivo.interrupt();
    const outcomes = Promise.allSettled([interrupting, reentered!]);
    tts.stops[0]!.reject(new Error("stop failed"));

    const [outer, inner] = await outcomes;
    expect(outer.status).toBe("rejected");
    expect(inner.status).toBe("rejected");
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

  it("stops the attached manager and calls nothing on a brain whose turn is generating", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    // Its submit() leaves the turn generating: `done` never settles.
    const brain = {
      setBody: vi.fn((_body: CharacterBody | null) => undefined),
      setCharacter: vi.fn((_character: Character) => undefined),
      submit: vi.fn(
        (_input: BrainInput): BrainTurn => ({
          id: "turn-1",
          done: new Promise<BrainTurnResult>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }),
      ),
      interrupt: vi.fn(async () => undefined),
      clearHistory: vi.fn(() => undefined),
      getHistory: vi.fn((): Message[] => []),
      dispose: vi.fn(async () => undefined),
    } satisfies ConversationBrain;
    charivo.attachBrain(brain);
    const turn = brain.submit({ kind: "user", text: "Hello" });
    const brainCalls = () =>
      [
        brain.setBody,
        brain.setCharacter,
        brain.submit,
        brain.interrupt,
        brain.clearHistory,
        brain.getHistory,
        brain.dispose,
        turn.cancel,
      ].map((method) => vi.mocked(method).mock.calls.length);
    const before = brainCalls();

    const interrupting = charivo.interrupt();

    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.resolve();
    await expect(interrupting).resolves.toBeUndefined();
    expect(brainCalls()).toEqual(before);
    expect(charivo.getBrain()).toBe(brain);
  });
});

describe("perform() while the brain's cleanup is pending", () => {
  it("refuses a perform() made right after dispose() starts", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    let finishCleanup!: () => void;
    const brain = {
      setBody: vi.fn((_body: CharacterBody | null) => undefined),
      setCharacter: vi.fn((_character: Character) => undefined),
      submit: vi.fn(
        (_input: BrainInput): BrainTurn => ({
          id: "turn-1",
          done: new Promise<BrainTurnResult>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }),
      ),
      interrupt: vi.fn(async () => undefined),
      clearHistory: vi.fn(() => undefined),
      getHistory: vi.fn((): Message[] => []),
      dispose: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishCleanup = resolve;
          }),
      ),
    } satisfies ConversationBrain;
    charivo.attachBrain(brain);

    const disposing = charivo.dispose();

    expect(() => charivo.perform({ text: "Too late." })).toThrow(
      CharivoStateError,
    );
    expect(tts.speak).not.toHaveBeenCalled();
    finishCleanup();
    await flush();
    for (const stop of tts.stops) {
      stop.resolve();
    }
    await disposing;
    expect(tts.speak).not.toHaveBeenCalled();
  });
});

describe("overlapping teardown", () => {
  it("shares one dispose() between overlapping calls", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);

    const first = charivo.dispose();
    const second = charivo.dispose();

    expect(second).toBe(first);
    expect(() => charivo.perform({ text: "Too late." })).toThrow(
      CharivoStateError,
    );
    await flush();
    for (const stop of tts.stops) {
      stop.resolve();
    }
    await first;
    expect(tts.stop).toHaveBeenCalledTimes(1);
    expect(charivo.dispose()).not.toBe(first);
  });

  it("refuses attachRealtime() from a listener during dispose()", async () => {
    const charivo = new Charivo();
    const realtime = new StubRealtimeManager();
    charivo.attachRealtime(realtime);
    let refused: unknown;
    charivo.on("floor:changed", ({ floor }) => {
      if (floor.state === "idle" && refused === undefined) {
        try {
          charivo.attachRealtime(new StubRealtimeManager());
        } catch (error) {
          refused = error;
        }
      }
    });

    await charivo.dispose();

    expect(refused).toBeInstanceOf(CharivoStateError);
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.getFloor()).toEqual({ state: "idle" });
  });

  it("reports a brain cleanup failure as a dispose error with its cause", async () => {
    const charivo = new Charivo();
    const failure = new CharivoProviderError("stop failed");
    const brain = {
      setBody: vi.fn((_body: CharacterBody | null) => undefined),
      setCharacter: vi.fn((_character: Character) => undefined),
      submit: vi.fn(
        (_input: BrainInput): BrainTurn => ({
          id: "turn-1",
          done: new Promise<BrainTurnResult>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }),
      ),
      interrupt: vi.fn(async () => undefined),
      clearHistory: vi.fn(() => undefined),
      getHistory: vi.fn((): Message[] => []),
      dispose: vi.fn(async () => {
        throw failure;
      }),
    } satisfies ConversationBrain;
    charivo.attachBrain(brain);

    await expect(charivo.dispose()).rejects.toMatchObject({
      name: "CharivoDisposeError",
      cause: failure,
    });
  });

  it("joins the teardown in progress from a performance:end listener", async () => {
    const charivo = new Charivo();
    const tts = Object.assign(new ReportingTTSManager(), {
      dispose: vi.fn(async () => undefined),
    });
    charivo.attachTTS(tts);
    charivo.perform({ text: "Hello there." });
    await flush();
    let nested: Promise<void> | undefined;
    charivo.on("performance:end", () => {
      nested ??= charivo.dispose();
    });

    const outer = charivo.dispose();
    await flush();

    expect(nested).toBe(outer);
    for (const stop of tts.stops) {
      stop.resolve();
    }
    await outer;
    expect(tts.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not stop the attached manager again after the brain's cleanup stopped it", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();
    const brain = {
      setBody: vi.fn((_body: CharacterBody | null) => undefined),
      setCharacter: vi.fn((_character: Character) => undefined),
      submit: vi.fn(
        (_input: BrainInput): BrainTurn => ({
          id: "turn-1",
          done: new Promise<BrainTurnResult>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }),
      ),
      interrupt: vi.fn(async () => undefined),
      clearHistory: vi.fn(() => undefined),
      getHistory: vi.fn((): Message[] => []),
      dispose: vi.fn(async () => {
        const cancelling = handle.cancel();
        tts.stops[0]!.resolve();
        await cancelling;
      }),
    } satisfies ConversationBrain;
    charivo.attachBrain(brain);

    await expect(charivo.dispose()).resolves.toBeUndefined();
    expect(tts.stop).toHaveBeenCalledTimes(1);
  });

  it("does not stop a manager again after the brain's cleanup stopped it", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();
    // The speaking manager is detached, so only the cancel stops it.
    charivo.detachTTS();
    const brain = {
      setBody: vi.fn((_body: CharacterBody | null) => undefined),
      setCharacter: vi.fn((_character: Character) => undefined),
      submit: vi.fn(
        (_input: BrainInput): BrainTurn => ({
          id: "turn-1",
          done: new Promise<BrainTurnResult>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }),
      ),
      interrupt: vi.fn(async () => undefined),
      clearHistory: vi.fn(() => undefined),
      getHistory: vi.fn((): Message[] => []),
      dispose: vi.fn(async () => {
        const cancelling = handle.cancel();
        tts.stops[0]!.resolve();
        await cancelling;
      }),
    } satisfies ConversationBrain;
    charivo.attachBrain(brain);

    await expect(charivo.dispose()).resolves.toBeUndefined();
    expect(tts.stop).toHaveBeenCalledTimes(1);
  });
});

describe("a stop issued during the teardown (P9)", () => {
  function brainWithCleanup(cleanup: () => Promise<void>): ConversationBrain {
    return {
      setBody: vi.fn((_body: CharacterBody | null) => undefined),
      setCharacter: vi.fn((_character: Character) => undefined),
      submit: vi.fn(
        (_input: BrainInput): BrainTurn => ({
          id: "turn-1",
          done: new Promise<BrainTurnResult>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }),
      ),
      interrupt: vi.fn(async () => undefined),
      clearHistory: vi.fn(() => undefined),
      getHistory: vi.fn((): Message[] => []),
      dispose: vi.fn(cleanup),
    };
  }

  it("retries once when the brain's cleanup stop failed", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();
    charivo.attachBrain(
      brainWithCleanup(async () => {
        const cancelling = handle.cancel();
        tts.stops[0]!.reject(new Error("stop failed"));
        await cancelling.catch(() => undefined);
      }),
    );

    const disposing = charivo.dispose();
    await flush();
    expect(tts.stop).toHaveBeenCalledTimes(2);
    tts.stops[1]!.resolve();

    await expect(disposing).resolves.toBeUndefined();
    expect(tts.stop).toHaveBeenCalledTimes(2);
  });

  it("reports its own retry's failure and does not stop the manager a third time", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();
    charivo.attachBrain(
      brainWithCleanup(async () => {
        const cancelling = handle.cancel();
        tts.stops[0]!.reject(new Error("stop failed"));
        await cancelling.catch(() => undefined);
      }),
    );

    const disposing = charivo.dispose();
    const outcome = disposing.then(
      () => undefined,
      (error: unknown) => error,
    );
    await flush();
    const retryFailure = new Error("retry failed");
    tts.stops[1]!.reject(retryFailure);

    await expect(outcome).resolves.toMatchObject({
      code: "CHARIVO_DISPOSE_ERROR",
      cause: { cause: retryFailure },
    });
    expect(tts.stop).toHaveBeenCalledTimes(2);
  });

  it("does not report a failed stop that a later stop during the teardown confirmed", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();
    let finishCleanup!: () => void;
    charivo.attachBrain(
      brainWithCleanup(
        () =>
          new Promise<void>((resolve) => {
            finishCleanup = resolve;
          }),
      ),
    );

    const disposing = charivo.dispose();
    const first = charivo.interrupt();
    tts.stops[0]!.reject(new Error("stop failed"));
    await expect(first).rejects.toBeInstanceOf(CharivoProviderError);
    const second = charivo.interrupt();
    tts.stops[1]!.resolve();
    await second;
    finishCleanup();

    await expect(disposing).resolves.toBeUndefined();
    expect(tts.stop).toHaveBeenCalledTimes(2);
  });

  it("does not stop a detached manager again after a stop confirmed during the teardown", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    charivo.perform({ text: "Hello there." });
    await flush();
    tts.startAudio();
    // Issued before the teardown, so only its success can settle the speech.
    void charivo.interrupt();
    charivo.detachTTS();
    charivo.attachBrain(
      brainWithCleanup(async () => {
        tts.stops[0]!.resolve();
        await flush();
      }),
    );

    const disposing = charivo.dispose();
    await flush();
    expect(tts.stop).toHaveBeenCalledTimes(1);
    for (const stop of tts.stops.slice(1)) {
      stop.resolve();
    }
    await expect(disposing).resolves.toBeUndefined();
  });
});

describe("dispose() errors", () => {
  it("keeps the message of a non-Error thrown by the brain's cleanup", async () => {
    const charivo = new Charivo();
    charivo.attachBrain({
      setBody: vi.fn((_body: CharacterBody | null) => undefined),
      setCharacter: vi.fn((_character: Character) => undefined),
      submit: vi.fn(
        (_input: BrainInput): BrainTurn => ({
          id: "turn-1",
          done: new Promise<BrainTurnResult>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }),
      ),
      interrupt: vi.fn(async () => undefined),
      clearHistory: vi.fn(() => undefined),
      getHistory: vi.fn((): Message[] => []),
      dispose: vi.fn(() => Promise.reject("cleanup failed")),
    });

    await expect(charivo.dispose()).rejects.toMatchObject({
      code: "CHARIVO_DISPOSE_ERROR",
      message: "cleanup failed",
      cause: "cleanup failed",
    });
  });

  it("passes through a dispose error from another copy of core", async () => {
    const charivo = new Charivo();
    // What isCharivoError() recognises from a duplicated @charivo/core.
    const foreign = Object.assign(new Error("foreign dispose failed"), {
      code: "CHARIVO_DISPOSE_ERROR",
      [Symbol.for("@charivo/core/CharivoError")]: true,
    });
    charivo.attachBrain({
      setBody: vi.fn((_body: CharacterBody | null) => undefined),
      setCharacter: vi.fn((_character: Character) => undefined),
      submit: vi.fn(
        (_input: BrainInput): BrainTurn => ({
          id: "turn-1",
          done: new Promise<BrainTurnResult>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }),
      ),
      interrupt: vi.fn(async () => undefined),
      clearHistory: vi.fn(() => undefined),
      getHistory: vi.fn((): Message[] => []),
      dispose: vi.fn(() => Promise.reject(foreign)),
    });

    await expect(charivo.dispose()).rejects.toBe(foreign);
  });
});

describe("handle.cancel() during dispose()", () => {
  it("gets the outcome of the stop the teardown issues", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    let cancelling: Promise<void> | undefined;
    charivo.on("performance:end", () => {
      cancelling ??= handle.cancel();
    });

    const disposing = charivo.dispose();
    const outcomes = Promise.allSettled([disposing, cancelling!]);
    await flush();
    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.reject(new Error("stop failed"));

    const [outer, inner] = await outcomes;
    expect(outer.status).toBe("rejected");
    expect(inner.status).toBe("rejected");
  });
});

describe("dispose() when the attached TTS manager changes", () => {
  it("gives handle.cancel() and dispose() the speaking manager's stop failure after a replacement before dispose()", async () => {
    const charivo = new Charivo();
    const first = new ReportingTTSManager();
    const second = new ReportingTTSManager();
    charivo.attachTTS(first);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    charivo.attachTTS(second);
    let cancelling: Promise<void> | undefined;
    charivo.on("performance:end", () => {
      cancelling ??= handle.cancel();
    });

    const disposing = charivo.dispose();
    const outcomes = Promise.allSettled([disposing, cancelling!]);
    await flush();
    expect(first.stop).toHaveBeenCalledTimes(1);
    first.stops[0]!.reject(new Error("stop failed"));
    await flush();
    second.stops[0]?.resolve();

    const [outer, inner] = await outcomes;
    expect(inner.status).toBe("rejected");
    expect(outer.status).toBe("rejected");
  });

  it("stops the speaking manager when the listener replaces TTS during performance:end", async () => {
    const charivo = new Charivo();
    const first = new ReportingTTSManager();
    const second = new ReportingTTSManager();
    charivo.attachTTS(first);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    let cancelling: Promise<void> | undefined;
    charivo.on("performance:end", () => {
      charivo.attachTTS(second);
      cancelling ??= handle.cancel();
    });

    const disposing = charivo.dispose();
    const outcomes = Promise.allSettled([disposing, cancelling!]);
    await flush();
    expect(first.stop).toHaveBeenCalledTimes(1);
    first.stops[0]!.reject(new Error("stop failed"));
    await flush();
    second.stops[0]?.resolve();

    const [outer, inner] = await outcomes;
    expect(inner.status).toBe("rejected");
    expect(outer.status).toBe("rejected");
  });
});

describe("the floor's audio watch after dispose()", () => {
  it("still marks speech heard before a tts:audio:start listener cancels, on a body reused after dispose()", async () => {
    const charivo = new Charivo();
    await charivo.dispose();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    let cancel: () => void = () => {};
    charivo.on("tts:audio:start", () => cancel());
    const handle = charivo.perform({ text: "Hello there." });
    cancel = () => void handle.cancel();
    await flush();

    tts.startAudio();

    expect(handle.result).toEqual({
      status: "cancelled",
      text: "Hello there.",
    });
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

  it("refuses a perform() made from a listener while dispose() has yet to stop the cancelled speech", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "First." });
    await flush();
    let refusal: unknown;
    charivo.on("performance:end", () => {
      try {
        charivo.perform({ text: "Second." });
      } catch (error) {
        refusal = error;
      }
    });

    const disposing = charivo.dispose();
    await flush();

    expect(handle.result).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(refusal).toBeInstanceOf(CharivoStateError);
    expect(charivo.getFloor()).toEqual({ state: "idle" });
    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(tts.stop).toHaveBeenCalledTimes(1);
    tts.stops[0]!.resolve();
    await disposing;
    expect(tts.speak).toHaveBeenCalledTimes(1);
  });

  it("stops the attached manager of an already cancelled performance when TTS is detached right after dispose()", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    const cancelling = expect(handle.cancel()).rejects.toThrow("device busy");
    tts.stops[0]!.reject(new Error("device busy"));
    await cancelling;

    const disposing = charivo.dispose();
    charivo.detachTTS();
    const failure = disposing.catch((error: unknown) => error);
    await flush();
    expect(tts.stop).toHaveBeenCalledTimes(2);
    tts.stops[1]!.reject(new Error("still stuck"));

    expect(await failure).toBeInstanceOf(CharivoError);
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
      affectResolved: false,
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

/** Records every call; the body must never call `interrupt` or `sendMessage` (R3). */
class StubRealtimeManager implements RealtimeManager {
  setCharacter = vi.fn((_character: Character) => undefined);
  getState = vi.fn(
    (): RealtimeState => ({
      connection: "idle",
      session: { status: "idle", config: null },
      response: { status: "idle", text: "" },
      audioPlaying: false,
      awaitingResponse: false,
      lastError: null,
    }),
  );
  startSession = vi.fn(async () => undefined);
  updateSession = vi.fn(async () => undefined);
  stopSession = vi.fn(async () => undefined);
  sendMessage = vi.fn(async (_text: string) => undefined);
  sendAudioChunk = vi.fn(async (_audio: ArrayBuffer) => undefined);
  interrupt = vi.fn(async () => undefined);
  registerTool = vi.fn((_tool: ToolRegistration) => undefined);
  unregisterTool = vi.fn((_name: string) => undefined);
  getRegisteredTools = vi.fn((): ToolDefinition[] => []);
  setEventEmitter = vi.fn((_emitter: CharivoEventEmitter) => undefined);
}

describe("playback reserved for realtime (R1)", () => {
  it("holds the floor from attachRealtime() to detachRealtime() and refuses perform() meanwhile", async () => {
    const charivo = new Charivo();
    charivo.attachTTS(new ReportingTTSManager());
    const events = recordFloorEvents(charivo);

    charivo.attachRealtime(new StubRealtimeManager());

    expect(charivo.getFloor()).toEqual({ state: "realtime" });
    expect(charivo.isRealtimeModeEnabled()).toBe(true);
    expect(events).toEqual([
      { event: "floor:changed", data: { floor: { state: "realtime" } } },
    ]);
    expect(() => charivo.perform({ text: "Hello there." })).toThrow(
      CharivoStateError,
    );
    expect(events).toHaveLength(1);

    charivo.detachRealtime();

    expect(charivo.getFloor()).toEqual({ state: "idle" });
    expect(charivo.isRealtimeModeEnabled()).toBe(false);
    expect(events.slice(1)).toEqual([
      { event: "floor:changed", data: { floor: { state: "idle" } } },
    ]);
    const handle = charivo.perform({ text: "Hello there." });
    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: handle.id,
      origin: "app",
    });
  });

  it("reports a floor:changed listener the attached manager", () => {
    const charivo = new Charivo();
    const realtime = new StubRealtimeManager();
    const seen: Array<RealtimeManager | undefined> = [];
    charivo.on("floor:changed", () => {
      seen.push(charivo.getRealtimeManager());
    });

    charivo.attachRealtime(realtime);
    charivo.detachRealtime();

    expect(seen).toEqual([realtime, undefined]);
  });

  it("emits nothing for detachRealtime() while not attached or a repeated attachRealtime()", () => {
    const charivo = new Charivo();
    const events = recordFloorEvents(charivo);

    charivo.detachRealtime();
    expect(events).toEqual([]);

    charivo.attachRealtime(new StubRealtimeManager());
    const replacement = new StubRealtimeManager();
    charivo.attachRealtime(replacement);

    expect(events).toEqual([
      { event: "floor:changed", data: { floor: { state: "realtime" } } },
    ]);
    expect(charivo.getRealtimeManager()).toBe(replacement);
  });

  it("does not wire a manager that a floor:changed listener detached or replaced mid-attach", () => {
    const charivo = new Charivo();
    charivo.setCharacter(character);
    const detached = new StubRealtimeManager();
    let detachOnce = true;
    charivo.on("floor:changed", ({ floor }) => {
      if (floor.state === "realtime" && detachOnce) {
        detachOnce = false;
        charivo.detachRealtime();
      }
    });

    charivo.attachRealtime(detached);

    expect(detached.setEventEmitter).not.toHaveBeenCalled();
    expect(detached.setCharacter).not.toHaveBeenCalled();
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.getFloor()).toEqual({ state: "idle" });

    const original = new StubRealtimeManager();
    const other = new StubRealtimeManager();
    let swapOnce = true;
    charivo.on("floor:changed", ({ floor }) => {
      if (floor.state === "realtime" && swapOnce) {
        swapOnce = false;
        charivo.attachRealtime(other);
      }
    });

    charivo.attachRealtime(original);

    expect(original.setEventEmitter).not.toHaveBeenCalled();
    expect(original.setCharacter).not.toHaveBeenCalled();
    expect(other.setEventEmitter).toHaveBeenCalledTimes(1);
    expect(charivo.getRealtimeManager()).toBe(other);
  });

  it("frees the floor with floor:changed when dispose() detaches realtime", async () => {
    const charivo = new Charivo();
    charivo.attachRealtime(new StubRealtimeManager());
    const events = recordFloorEvents(charivo);

    await charivo.dispose();

    expect(events).toEqual([
      { event: "floor:changed", data: { floor: { state: "idle" } } },
    ]);
  });

  it("refuses a perform() made from a listener of the state the manager emits while attaching", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    charivo.setCharacter(character);
    // As the built-in manager does, setCharacter() emits realtime:state.
    const realtime = new StubRealtimeManager();
    let emitter: CharivoEventEmitter | undefined;
    realtime.setEventEmitter.mockImplementation((next) => {
      emitter = next;
    });
    realtime.setCharacter.mockImplementation(() => {
      emitter?.emit("realtime:state", { state: realtime.getState() });
    });
    const refusals: unknown[] = [];
    charivo.on("realtime:state", () => {
      try {
        charivo.perform({ text: "Hello there." });
      } catch (error) {
        refusals.push(error);
      }
    });

    charivo.attachRealtime(realtime);
    await flush();

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toBeInstanceOf(CharivoStateError);
    expect(tts.speak).not.toHaveBeenCalled();
    expect(charivo.getFloor()).toEqual({ state: "realtime" });
  });

  it.each(["setEventEmitter", "setCharacter"] as const)(
    "leaves realtime detached and the floor idle when the manager's %s() throws",
    (member) => {
      const charivo = new Charivo();
      charivo.setCharacter(character);
      const realtime = new StubRealtimeManager();
      const failure = new Error(`${member} failed`);
      realtime[member].mockImplementation(() => {
        throw failure;
      });
      const events = recordFloorEvents(charivo);

      expect(() => charivo.attachRealtime(realtime)).toThrow(failure);

      expect(charivo.getRealtimeManager()).toBeUndefined();
      expect(charivo.isRealtimeModeEnabled()).toBe(false);
      expect(charivo.getFloor()).toEqual({ state: "idle" });
      expect(events.at(-1)).toEqual({
        event: "floor:changed",
        data: { floor: { state: "idle" } },
      });
      expect(() => charivo.perform({ text: "Hello there." })).not.toThrow();
    },
  );

  it("starts in realtime when createCharivo() is given a realtime manager", () => {
    const charivo = createCharivo({ realtime: new StubRealtimeManager() });

    expect(charivo.getFloor()).toEqual({ state: "realtime" });
    expect(() => charivo.perform({ text: "Hello there." })).toThrow(
      CharivoStateError,
    );
  });
});

describe("attaching realtime after cascade speech (R2, R3)", () => {
  it("throws while a performance holds the floor and attaches nothing", async () => {
    const charivo = new Charivo();
    charivo.attachTTS(new ReportingTTSManager());
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    const events = recordFloorEvents(charivo);
    const realtime = new StubRealtimeManager();

    expect(() => charivo.attachRealtime(realtime)).toThrow(CharivoStateError);

    expect(charivo.getFloor()).toEqual({
      state: "speaking",
      performanceId: handle.id,
      origin: "app",
    });
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.isRealtimeModeEnabled()).toBe(false);
    expect(realtime.setEventEmitter).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("throws after cancel() while its stop is pending, and attaches after an awaited interrupt()", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();

    void handle.cancel();
    expect(charivo.getFloor()).toEqual({ state: "idle" });
    expect(() => charivo.attachRealtime(new StubRealtimeManager())).toThrow(
      CharivoStateError,
    );

    const interrupting = charivo.interrupt();
    tts.stops[0]!.resolve();
    await interrupting;
    const realtime = new StubRealtimeManager();
    charivo.attachRealtime(realtime);

    expect(charivo.getFloor()).toEqual({ state: "realtime" });
    expect(charivo.getRealtimeManager()).toBe(realtime);
  });

  it("keeps refusing after an interrupt() that rejected, even once the old speak() settled, until one resolves", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    charivo.perform({ text: "Hello there." });
    await flush();

    const stopError = charivo.interrupt().catch((error: unknown) => error);
    tts.stops[0]!.reject(new Error("device busy"));
    const error = await stopError;
    expect(error).toBeInstanceOf(CharivoProviderError);
    expect(() => charivo.attachRealtime(new StubRealtimeManager())).toThrow(
      expect.objectContaining({ name: "CharivoStateError", cause: error }),
    );

    tts.speaks[0]!.resolve();
    await flush();
    expect(() => charivo.attachRealtime(new StubRealtimeManager())).toThrow(
      CharivoStateError,
    );

    const interrupting = charivo.interrupt();
    tts.stops[1]!.resolve();
    await interrupting;
    charivo.attachRealtime(new StubRealtimeManager());

    expect(charivo.getFloor()).toEqual({ state: "realtime" });
  });

  it("never calls the realtime manager's interrupt() or sendMessage()", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const realtime = new StubRealtimeManager();
    charivo.attachRealtime(realtime);

    const interrupting = charivo.interrupt();
    tts.stops[0]!.resolve();
    await interrupting;
    expect(() => charivo.perform({ text: "Hello there." })).toThrow(
      CharivoStateError,
    );
    charivo.detachRealtime();
    charivo.perform({ text: "Hello there." });
    await flush();
    tts.finishSpeech(0);
    await flush();

    expect(realtime.interrupt).not.toHaveBeenCalled();
    expect(realtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe("perform() affect (A2, A3)", () => {
  const affectMap: AffectMap = {
    joy: { expressionId: "smile", motion: { group: "Happy", index: 1 } },
    calm: { expressionId: "relaxed" },
  };

  const AFFECT_EVENTS = [
    ...RECORDED_EVENTS,
    "avatar:expression",
    "avatar:motion",
  ] as const;

  /** Floor and affect events, with whether a render had begun at each. */
  function recordAffectEvents(
    charivo: Charivo,
    renderer?: RecordingRenderManager,
  ) {
    const events: Array<RecordedEvent & { rendered: boolean }> = [];
    for (const event of AFFECT_EVENTS) {
      charivo.on(event, (data) => {
        events.push({
          event,
          data,
          rendered: (renderer?.render.mock.calls.length ?? 0) > 0,
        } as RecordedEvent & { rendered: boolean });
      });
    }
    return events;
  }

  it("drops the motion when an expression listener cancels the line", async () => {
    const charivo = new Charivo();
    charivo.attachTTS(new ReportingTTSManager());
    charivo.setAffectMap(affectMap);
    const motions: unknown[] = [];
    charivo.on("avatar:motion", (data) => motions.push(data));
    // Delivered inside perform(), before the handle is returned.
    charivo.on("avatar:expression", () => {
      void charivo.interrupt();
    });

    const handle = charivo.perform({
      text: "Hello there.",
      affect: { expression: { affect: "joy" } },
    });

    expect((await handle.done).status).toBe("cancelled");
    expect(motions).toEqual([]);
  });

  it("emits a held expression and a muted motion right after a voiced performance's start, before the render", async () => {
    const charivo = new Charivo();
    const renderer = new RecordingRenderManager();
    const tts = new ReportingTTSManager();
    charivo.attachRenderer(renderer);
    charivo.attachTTS(tts);
    charivo.setAffectMap(affectMap);
    const events = recordAffectEvents(charivo, renderer);

    const handle = charivo.perform({
      text: "Hello there.",
      affect: { expression: { affect: "joy" } },
    });
    // Affect is the run's first step, a turn after perform() returns.
    await flush();

    expect(events.map(({ event }) => event).slice(0, 4)).toEqual([
      "floor:changed",
      "performance:start",
      "avatar:expression",
      "avatar:motion",
    ]);
    expect(events.slice(0, 4).every(({ rendered }) => !rendered)).toBe(true);
    expect(events[1]!.data).toEqual(
      expect.objectContaining({ voiced: true, affectResolved: true }),
    );
    expect(events[2]!.data).toEqual({
      expressionId: "smile",
      source: "performance",
      priority: "explicit",
      hold: { performance: handle.id },
    });
    expect(events[3]!.data).toEqual({
      group: "Happy",
      index: 1,
      muteSound: true,
      priority: "explicit",
    });

    await flush();
    tts.finishSpeech(0);
    await handle.done;
    expect(events.map(({ event }) => event).slice(4)).toEqual([
      "performance:end",
      "floor:changed",
    ]);
  });

  it("emits the expression with no hold for an unvoiced performance", async () => {
    const charivo = new Charivo();
    charivo.attachRenderer(new RecordingRenderManager());
    charivo.setAffectMap(affectMap);
    const events = recordAffectEvents(charivo);

    const handle = charivo.perform({
      text: "Hello there.",
      affect: { expression: "wink", motion: { group: "Wave" } },
    });
    await handle.done;

    expect(events[1]!.data).toEqual(
      expect.objectContaining({ voiced: false, affectResolved: true }),
    );
    expect(events[2]).toEqual(
      expect.objectContaining({
        event: "avatar:expression",
        data: {
          expressionId: "wink",
          source: "performance",
          priority: "explicit",
        },
      }),
    );
    expect(events[3]).toEqual(
      expect.objectContaining({
        event: "avatar:motion",
        data: {
          group: "Wave",
          index: 0,
          muteSound: true,
          priority: "explicit",
        },
      }),
    );
  });

  it("sets affectResolved true and emits that event alone for a cue resolved to only an expression or only a motion", async () => {
    const charivo = new Charivo();
    charivo.setAffectMap(affectMap);
    const events = recordAffectEvents(charivo);

    charivo.perform({
      text: "One.",
      affect: { expression: { affect: "calm" } },
    });
    await flush();
    charivo.perform({
      text: "Two.",
      affect: { motion: { group: "Nod", index: 2 } },
    });
    await flush();

    expect(events.map(({ event }) => event)).toEqual([
      "floor:changed",
      "performance:start",
      "avatar:expression",
      "performance:end",
      "floor:changed",
      "floor:changed",
      "performance:start",
      "avatar:motion",
      "performance:end",
      "floor:changed",
    ]);
    expect(events[1]!.data).toEqual(
      expect.objectContaining({ affectResolved: true }),
    );
    expect(events[6]!.data).toEqual(
      expect.objectContaining({ affectResolved: true }),
    );
  });

  it("sets affectResolved false and emits no affect for an unmapped label or no affect", () => {
    const charivo = new Charivo();
    charivo.setAffectMap(affectMap);
    const events = recordAffectEvents(charivo);

    charivo.perform({
      text: "One.",
      affect: { expression: { affect: "grief" } },
    });
    charivo.perform({ text: "Two." });

    const starts = events.filter(({ event }) => event === "performance:start");
    expect(starts.map(({ data }) => data)).toEqual([
      expect.objectContaining({ affectResolved: false }),
      expect.objectContaining({ affectResolved: false }),
    ]);
    expect(events.filter(({ event }) => event.startsWith("avatar:"))).toEqual(
      [],
    );
  });

  it("resolves through the map set last, and through none after setAffectMap(null)", async () => {
    const charivo = new Charivo();
    const expressions: string[] = [];
    charivo.on("avatar:expression", ({ expressionId }) => {
      expressions.push(expressionId);
    });
    const joy = { expression: { affect: "joy" } };

    charivo.perform({ text: "One.", affect: joy });
    await flush();
    charivo.setAffectMap(affectMap);
    charivo.perform({ text: "Two.", affect: joy });
    await flush();
    charivo.setAffectMap({ joy: { expressionId: "grin" } });
    charivo.perform({ text: "Three.", affect: joy });
    await flush();
    charivo.setAffectMap(null);
    charivo.perform({ text: "Four.", affect: joy });
    await flush();

    expect(expressions).toEqual(["smile", "grin"]);
  });

  it("emits nothing for a performance displaced by a performance:start listener", async () => {
    const charivo = new Charivo();
    charivo.setAffectMap(affectMap);
    const events = recordAffectEvents(charivo);
    let second: PerformanceHandle | undefined;
    charivo.on("performance:start", () => {
      if (!second) {
        second = charivo.perform({
          text: "Second.",
          affect: { expression: { affect: "calm" } },
        });
      }
    });

    const first = charivo.perform({
      text: "First.",
      affect: { expression: { affect: "joy" } },
    });
    await flush();

    const affectEvents = events.filter(({ event }) =>
      event.startsWith("avatar:"),
    );
    expect(affectEvents.map(({ data }) => data)).toEqual([
      {
        expressionId: "relaxed",
        source: "performance",
        priority: "explicit",
      },
    ]);
    expect(first.result).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(
      events.map(({ event, data }) =>
        "performanceId" in data ? `${event}:${data.performanceId}` : event,
      ),
    ).toEqual([
      "floor:changed",
      `performance:start:${first.id}`,
      `performance:end:${first.id}`,
      "floor:changed",
      `performance:start:${second!.id}`,
      "avatar:expression",
      `performance:end:${second!.id}`,
      "floor:changed",
    ]);
  });

  it("forgets the map on dispose()", async () => {
    const charivo = new Charivo();
    charivo.setAffectMap(affectMap);
    await charivo.dispose();
    const events = recordAffectEvents(charivo);

    charivo.perform({
      text: "Hello there.",
      affect: { expression: { affect: "joy" } },
    });

    expect(events[1]!.data).toEqual(
      expect.objectContaining({ affectResolved: false }),
    );
    expect(events.filter(({ event }) => event.startsWith("avatar:"))).toEqual(
      [],
    );
  });
});

describe("perform() affect and a cancel right after it returns (A3)", () => {
  it("emits no expression or motion for a handle cancelled before perform()'s caller yields", async () => {
    const charivo = new Charivo();
    charivo.setAffectMap({
      joy: { expressionId: "smile", motion: { group: "Happy", index: 1 } },
    });
    const avatar: string[] = [];
    charivo.on("avatar:expression", () => avatar.push("expression"));
    charivo.on("avatar:motion", () => avatar.push("motion"));

    const handle = charivo.perform({
      text: "Hello there.",
      affect: { expression: { affect: "joy" } },
    });
    void handle.cancel();
    await flush();

    expect(avatar).toEqual([]);
  });
});

describe("react() (A4)", () => {
  const affectMap: AffectMap = {
    joy: { expressionId: "smile", motion: { group: "Happy", index: 1 } },
    calm: { expressionId: "relaxed" },
  };

  const REACTION_EVENTS = [
    ...RECORDED_EVENTS,
    "avatar:expression",
    "avatar:gaze",
    "avatar:motion",
    "avatar:release",
  ] as const;

  function recordReactionEvents(charivo: Charivo): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const event of REACTION_EVENTS) {
      charivo.on(event, (data) => {
        events.push({ event, data } as RecordedEvent);
      });
    }
    return events;
  }

  it("emits the expression, gaze and muted motion with the request's claim fields, priority reflex by default, and one claimId", () => {
    const charivo = new Charivo();
    charivo.setAffectMap(affectMap);
    const events = recordReactionEvents(charivo);

    charivo.react({
      expression: { affect: "joy" },
      gaze: { x: 0.2, y: -0.1 },
      source: "game",
      hold: "until-release",
    });

    expect(events.map(({ event }) => event)).toEqual([
      "avatar:expression",
      "avatar:gaze",
      "avatar:motion",
    ]);
    const claimId = (events[0]!.data as EventMap["avatar:expression"]).claimId;
    expect(claimId).toEqual(expect.any(String));
    expect(events[0]!.data).toEqual({
      expressionId: "smile",
      source: "game",
      hold: "until-release",
      priority: "reflex",
      claimId,
    });
    expect(events[1]!.data).toEqual({
      x: 0.2,
      y: -0.1,
      source: "game",
      hold: "until-release",
      priority: "reflex",
      claimId,
    });
    expect(events[2]!.data).toEqual({
      group: "Happy",
      index: 1,
      muteSound: true,
      priority: "reflex",
    });
    expect(charivo.getFloor()).toEqual({ state: "idle" });
  });

  it("carries a given priority and hold", () => {
    const charivo = new Charivo();
    const events = recordReactionEvents(charivo);

    charivo.react({
      expression: "wink",
      motion: { group: "Nod" },
      gaze: { x: 0, y: 1 },
      source: "director",
      hold: { ms: 500 },
      priority: "inferred",
    });

    expect(events.map(({ data }) => data)).toEqual([
      expect.objectContaining({
        expressionId: "wink",
        hold: { ms: 500 },
        priority: "inferred",
      }),
      expect.objectContaining({ hold: { ms: 500 }, priority: "inferred" }),
      { group: "Nod", index: 0, muteSound: true, priority: "inferred" },
    ]);
  });

  it("returns what the cue resolved to: a raw id, a mapped label, or nothing for an unmapped one", () => {
    const charivo = new Charivo();
    charivo.setAffectMap(affectMap);
    const events = recordReactionEvents(charivo);
    const hold = "until-release" as const;

    expect(
      charivo.react({ expression: "wink", source: "a", hold }).resolved,
    ).toEqual({ expressionId: "wink" });
    expect(
      charivo.react({ expression: { affect: "calm" }, source: "a", hold })
        .resolved,
    ).toEqual({ expressionId: "relaxed" });
    expect(events).toHaveLength(2);

    expect(
      charivo.react({ expression: { affect: "grief" }, source: "a", hold })
        .resolved,
    ).toEqual({});
    expect(events).toHaveLength(2);
  });

  it("leaves the floor and a running performance alone, and the performance completes", async () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    const floor = charivo.getFloor();
    const events = recordReactionEvents(charivo);

    charivo.react({
      expression: "startled",
      source: "game",
      hold: "until-release",
    });

    expect(events.map(({ event }) => event)).toEqual(["avatar:expression"]);
    expect(charivo.getFloor()).toEqual(floor);
    expect(tts.stop).not.toHaveBeenCalled();
    tts.finishSpeech(0);
    expect((await handle.done).status).toBe("completed");
  });

  it.each(["explicit", "inferred", "ambient"] as const)(
    "throws CharivoStateError for critical at priority %s before anything is emitted",
    async (priority) => {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      charivo.attachTTS(tts);
      const handle = charivo.perform({ text: "Hello there." });
      await flush();
      const events = recordReactionEvents(charivo);

      expect(() =>
        charivo.react({
          expression: "startled",
          gaze: { x: 0, y: 0 },
          source: "game",
          hold: "until-release",
          priority,
          critical: true,
        }),
      ).toThrow(CharivoStateError);

      expect(events).toEqual([]);
      expect(handle.result).toBeUndefined();
      expect(tts.stop).not.toHaveBeenCalled();
    },
  );
});

describe("ReactionHandle.release() (A5)", () => {
  function recordReleases(charivo: Charivo): EventMap["avatar:release"][] {
    const releases: EventMap["avatar:release"][] = [];
    charivo.on("avatar:release", (data) => releases.push(data));
    return releases;
  }

  it("emits, once, one avatar:release per claimed channel with the reaction's claimId", () => {
    const charivo = new Charivo();
    let claimId: string | undefined;
    charivo.on("avatar:expression", (data) => {
      claimId = data.claimId;
    });
    const releases = recordReleases(charivo);

    const reaction = charivo.react({
      expression: "startled",
      gaze: { x: 1, y: 0 },
      motion: { group: "Flinch" },
      source: "game",
      hold: "until-release",
    });
    expect(releases).toEqual([]);

    reaction.release();
    reaction.release();

    expect(releases).toEqual([
      { source: "game", channel: "expression", claimId },
      { source: "game", channel: "gaze", claimId },
    ]);
  });

  it("releases only the channels it claimed", () => {
    const charivo = new Charivo();
    const releases = recordReleases(charivo);
    const hold = "until-release" as const;

    charivo.react({ gaze: { x: 1, y: 0 }, source: "a", hold }).release();
    charivo.react({ expression: "wink", source: "b", hold }).release();
    charivo.react({ motion: { group: "Nod" }, source: "c", hold }).release();
    charivo
      .react({ expression: { affect: "joy" }, source: "d", hold })
      .release();

    expect(releases).toEqual([
      expect.objectContaining({ source: "a", channel: "gaze" }),
      expect.objectContaining({ source: "b", channel: "expression" }),
    ]);
  });

  it("gives two reactions from one source different claimIds", () => {
    const charivo = new Charivo();
    const releases = recordReleases(charivo);
    const request = {
      expression: "startled",
      source: "game",
      hold: "until-release" as const,
    };

    const first = charivo.react(request);
    const second = charivo.react(request);
    first.release();
    second.release();

    expect(releases).toHaveLength(2);
    expect(releases[0]!.claimId).toEqual(expect.any(String));
    expect(releases[1]!.claimId).toEqual(expect.any(String));
    expect(releases[0]!.claimId).not.toBe(releases[1]!.claimId);
  });
});

describe("a critical reflex (A6)", () => {
  it.each([
    ["a resolved cue", { expression: "startled" }],
    ["a cue that resolved to nothing", { expression: { affect: "grief" } }],
  ])(
    "ends the floor's performance cancelled and stops its TTS, with %s",
    async (_label, cue) => {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      charivo.attachTTS(tts);
      const events = recordFloorEvents(charivo);
      const handle = charivo.perform({ text: "Hello there." });
      await flush();
      expect(tts.speak).toHaveBeenCalledTimes(1);

      charivo.react({
        ...cue,
        source: "game",
        hold: "until-release",
        critical: true,
      });

      expect(handle.result).toEqual(
        expect.objectContaining({ status: "cancelled" }),
      );
      expect(charivo.getFloor()).toEqual({ state: "idle" });
      expect(tts.stop).toHaveBeenCalledTimes(1);
      expect(events.slice(-2).map(({ event }) => event)).toEqual([
        "performance:end",
        "floor:changed",
      ]);
      tts.stops[0]!.resolve();
      await expect(handle.done).resolves.toEqual(
        expect.objectContaining({ status: "cancelled" }),
      );
    },
  );

  it("cancels the performance before its reaction is shown", async () => {
    const charivo = new Charivo();
    charivo.attachTTS(new ReportingTTSManager());
    const handle = charivo.perform({ text: "Hello there." });
    await flush();
    const seen: Array<PerformanceHandle["result"]> = [];
    charivo.on("avatar:expression", () => seen.push(handle.result));

    charivo.react({
      expression: "startled",
      source: "game",
      hold: "until-release",
      critical: true,
    });

    expect(seen).toEqual([expect.objectContaining({ status: "cancelled" })]);
  });

  it("reports a rejected stop with console.error, as no caller waits for it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const charivo = new Charivo();
      const tts = new ReportingTTSManager();
      charivo.attachTTS(tts);
      charivo.perform({ text: "Hello there." });
      await flush();

      charivo.react({ source: "game", hold: "until-release", critical: true });
      tts.stops[0]!.reject(new Error("device busy"));
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to stop cancelled speech:",
        expect.any(CharivoProviderError),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("cancels nothing in realtime mode, and still emits the reaction (R1)", () => {
    const charivo = new Charivo();
    const tts = new ReportingTTSManager();
    const realtime = new StubRealtimeManager();
    charivo.attachTTS(tts);
    charivo.attachRealtime(realtime);
    const floorEvents = recordFloorEvents(charivo);
    const expressions: string[] = [];
    charivo.on("avatar:expression", ({ expressionId }) => {
      expressions.push(expressionId);
    });

    charivo.react({
      expression: "startled",
      source: "game",
      hold: "until-release",
      critical: true,
    });

    expect(expressions).toEqual(["startled"]);
    expect(floorEvents).toEqual([]);
    expect(charivo.getFloor()).toEqual({ state: "realtime" });
    expect(tts.stop).not.toHaveBeenCalled();
    expect(realtime.interrupt).not.toHaveBeenCalled();
  });
});

describe("react() through a real RenderManager (A5)", () => {
  class StubRenderer implements Renderer {
    initialize = vi.fn(async () => undefined);
    destroy = vi.fn(async () => undefined);
    render = vi.fn(
      async (_message: Message, _character?: Character) => undefined,
    );
    playExpression = vi.fn((_expressionId: string) => undefined);
    stopExpression = vi.fn(() => undefined);
    getAvailableExpressions = vi.fn(() => [
      "exp_happy",
      "exp_sad",
      "exp_startled",
    ]);
  }

  function setup() {
    const charivo = new Charivo();
    const renderer = new StubRenderer();
    charivo.attachRenderer(createRenderManager(renderer));
    return { charivo, renderer };
  }

  it("shows the reflex over the line's expression and falls back to it on release()", async () => {
    const { charivo, renderer } = setup();
    const tts = new ReportingTTSManager();
    charivo.attachTTS(tts);

    const handle = charivo.perform({
      text: "Hello there.",
      affect: { expression: "exp_happy" },
    });
    await flush();
    const reaction = charivo.react({
      expression: "exp_startled",
      source: "game",
      hold: "until-release",
    });
    reaction.release();

    expect(renderer.playExpression.mock.calls).toEqual([
      ["exp_happy"],
      ["exp_startled"],
      ["exp_happy"],
    ]);
    expect(renderer.stopExpression).not.toHaveBeenCalled();
    tts.finishSpeech(0);
    await handle.done;
  });

  it("leaves a newer expression from the reaction's source showing on an old handle's release()", () => {
    const { charivo, renderer } = setup();

    const reaction = charivo.react({
      expression: "exp_startled",
      source: "game",
      hold: "until-release",
    });
    charivo.emit("avatar:expression", {
      expressionId: "exp_sad",
      source: "game",
      hold: "until-release",
    });
    reaction.release();

    expect(renderer.playExpression.mock.calls).toEqual([
      ["exp_startled"],
      ["exp_sad"],
    ]);
    expect(renderer.stopExpression).not.toHaveBeenCalled();
  });

  it("still releases its own expression after a direct one naming an expression the model lacks", () => {
    const { charivo, renderer } = setup();

    const reaction = charivo.react({
      expression: "exp_startled",
      source: "game",
      hold: "until-release",
    });
    charivo.emit("avatar:expression", {
      expressionId: "exp_missing",
      source: "game",
      hold: "until-release",
    });
    reaction.release();

    expect(renderer.playExpression.mock.calls).toEqual([["exp_startled"]]);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });
});
