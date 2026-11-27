import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AvatarControlCatalog,
  CharivoEventEmitter,
  EventMap,
} from "@charivo/core";
import {
  createAvatarDirector,
  type AvatarClassifier,
  type AvatarDecision,
  type AvatarDirector,
} from "@charivo/avatar";

const CATALOG: AvatarControlCatalog = {
  expressions: ["happy", "sad"],
  motions: { Idle: 2, Tap: 1 },
};

type Emission = { [K in keyof EventMap]: [K, EventMap[K]] }[keyof EventMap];

/**
 * Records emissions and, like the real bus, runs listeners synchronously
 * inside `emit`.
 */
function createRecordingEmitter() {
  const emissions: Emission[] = [];
  const listeners: Array<(emission: Emission) => void> = [];
  const emitter: CharivoEventEmitter = {
    emit(event, data) {
      const emission = [event, data] as Emission;
      emissions.push(emission);
      for (const listener of listeners) {
        listener(emission);
      }
    },
  };
  return {
    emitter,
    emissions,
    onEmit(listener: (emission: Emission) => void) {
      listeners.push(listener);
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A classifier whose calls each return a promise the test settles by hand. */
function createControlledClassifier() {
  const calls: Array<
    Parameters<AvatarClassifier>[0] & { result: Deferred<AvatarDecision> }
  > = [];
  const classifier = vi.fn<AvatarClassifier>((input) => {
    const result = deferred<AvatarDecision>();
    calls.push({ ...input, result });
    return result.promise;
  });
  return { classifier, calls };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(
  options: {
    catalog?: AvatarControlCatalog;
    classifier?: AvatarClassifier;
    onError?: (error: unknown) => void;
  } = {},
) {
  const recording = createRecordingEmitter();
  const controlled = createControlledClassifier();
  const director: AvatarDirector = createAvatarDirector({
    catalog: options.catalog ?? CATALOG,
    classifier: options.classifier ?? controlled.classifier,
    emitter: recording.emitter,
    ...(options.onError ? { onError: options.onError } : {}),
  });
  return { director, ...recording, ...controlled };
}

describe("createAvatarDirector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("complete line", () => {
    it("classifies the text once with the catalog and a signal", () => {
      const { director, classifier, calls } = setup();

      director.say("Hello there!");

      expect(classifier).toHaveBeenCalledTimes(1);
      expect(calls[0]?.text).toBe("Hello there!");
      expect(calls[0]?.catalog).toBe(CATALOG);
      expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
      expect(calls[0]?.signal.aborted).toBe(false);
    });

    it("emits the expression and a muted motion from the decision", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hello there!");
      calls[0]?.result.resolve({
        expressionId: "happy",
        motion: { group: "Tap", index: 0 },
      });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
        [
          "avatar:motion",
          { group: "Tap", index: 0, muteSound: true, priority: "inferred" },
        ],
      ]);
    });

    it("emits only the expression when the decision has no motion", async () => {
      const { director, calls, emissions } = setup();

      director.say("Oh no.");
      calls[0]?.result.resolve({ expressionId: "sad" });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "sad",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });

    it("emits only the motion when the decision has no expression", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hi!");
      calls[0]?.result.resolve({ motion: { group: "Idle", index: 1 } });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:motion",
          { group: "Idle", index: 1, muteSound: true, priority: "inferred" },
        ],
      ]);
    });

    it("emits nothing for an empty decision", async () => {
      const { director, calls, emissions } = setup();

      director.say("Okay.");
      calls[0]?.result.resolve({});
      await flush();

      expect(emissions).toEqual([]);
    });
  });

  describe("performanceId", () => {
    it("binds the expression to the performance with a hold", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hello there!", { performanceId: "perf-1" });
      calls[0]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
            hold: { performance: "perf-1" },
          },
        ],
      ]);
    });

    it("emits no hold without a performanceId", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hello there!");
      calls[0]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions[0]?.[1]).not.toHaveProperty("hold");
    });
  });

  describe("validation against the catalog", () => {
    it("drops an unknown expression id", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hmm.");
      calls[0]?.result.resolve({ expressionId: "furious" });
      await flush();

      expect(emissions).toEqual([]);
    });

    it("drops an unknown motion group", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hmm.");
      calls[0]?.result.resolve({ motion: { group: "Dance", index: 0 } });
      await flush();

      expect(emissions).toEqual([]);
    });

    it.each([
      ["non-integer", 0.5],
      ["negative", -1],
      ["past the group's count", 2],
      ["NaN", Number.NaN],
    ])("drops a %s motion index", async (_label, index) => {
      const { director, calls, emissions } = setup();

      director.say("Hmm.");
      calls[0]?.result.resolve({ motion: { group: "Idle", index } });
      await flush();

      expect(emissions).toEqual([]);
    });

    it("drops a group inherited from Object.prototype", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hmm.");
      calls[0]?.result.resolve({ motion: { group: "constructor", index: 0 } });
      await flush();

      expect(emissions).toEqual([]);
    });

    it("keeps the valid motion when the expression is invalid", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hmm.");
      calls[0]?.result.resolve({
        expressionId: "furious",
        motion: { group: "Tap", index: 0 },
      });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:motion",
          { group: "Tap", index: 0, muteSound: true, priority: "inferred" },
        ],
      ]);
    });

    it("keeps the valid expression when the motion is invalid", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hmm.");
      calls[0]?.result.resolve({
        expressionId: "happy",
        motion: { group: "Tap", index: 3 },
      });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });
  });

  describe("incremental input", () => {
    it("makes no call while chunks are pushed", () => {
      const { director, classifier } = setup();

      director.push("Hello ");
      director.push("there");

      expect(classifier).not.toHaveBeenCalled();
    });

    it("classifies the concatenated chunks once at done()", () => {
      const { director, classifier, calls } = setup();

      director.push("Hello ");
      director.push("there");
      director.push("!");
      director.done();

      expect(classifier).toHaveBeenCalledTimes(1);
      expect(calls[0]?.text).toBe("Hello there!");
    });

    it("starts a new line with an empty buffer on a push after done()", () => {
      const { director, calls } = setup();

      director.push("First line.");
      director.done();
      director.push("Second ");
      director.push("line.");
      director.done();

      expect(calls.map((call) => call.text)).toEqual([
        "First line.",
        "Second line.",
      ]);
    });

    it("drops an open buffer when say() starts a new line", () => {
      const { director, calls } = setup();

      director.push("Dropped ");
      director.say("Spoken.");
      director.done();

      expect(calls.map((call) => call.text)).toEqual(["Spoken."]);
    });

    it("makes no call for a blank line", () => {
      const { director, classifier } = setup();

      director.push("  ");
      director.push("\n");
      director.done();
      director.say("   ");
      director.done();

      expect(classifier).not.toHaveBeenCalled();
    });

    it("makes no call when the catalog has no expressions and no motions", () => {
      const { director, classifier } = setup({
        catalog: { expressions: [], motions: {} },
      });

      director.say("Hello there!");
      director.push("Hello again.");
      director.done();

      expect(classifier).not.toHaveBeenCalled();
    });

    it("makes no call when every motion group has no clips and there are no expressions", () => {
      const { director, classifier } = setup({
        catalog: { expressions: [], motions: { Idle: 0, Tap: 0 } },
      });

      director.say("Hello there!");

      expect(classifier).not.toHaveBeenCalled();
    });
  });

  describe("staleness between lines", () => {
    it("aborts and drops a pending decision when a second say begins", async () => {
      const { director, calls, emissions } = setup();

      director.say("First.");
      director.say("Second.");

      expect(calls[0]?.signal.aborted).toBe(true);
      expect(calls[1]?.signal.aborted).toBe(false);

      calls[1]?.result.resolve({ expressionId: "sad" });
      await flush();
      calls[0]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "sad",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });

    it("aborts and drops a pending decision at the first push of a new line", async () => {
      const { director, calls, emissions } = setup();

      director.say("First.");
      director.push("Sec");

      expect(calls[0]?.signal.aborted).toBe(true);

      calls[0]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions).toEqual([]);
    });
  });

  describe("cancel()", () => {
    it("aborts and drops a pending decision", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hello.");
      director.cancel();

      expect(calls[0]?.signal.aborted).toBe(true);

      calls[0]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions).toEqual([]);
    });

    it("discards the open buffer between chunks", () => {
      const { director, calls } = setup();

      director.push("Dropped ");
      director.cancel();
      director.push("Kept.");
      director.done();

      expect(calls.map((call) => call.text)).toEqual(["Kept."]);
    });

    it("leaves nothing to classify at a done() right after cancel()", () => {
      const { director, classifier } = setup();

      director.push("Dropped.");
      director.cancel();
      director.done();

      expect(classifier).not.toHaveBeenCalled();
    });
  });

  describe("synchronous recheck between emissions", () => {
    it("stops the motion when an expression listener cancels", async () => {
      const { director, calls, emissions, onEmit } = setup();
      onEmit(([event]) => {
        if (event === "avatar:expression") {
          director.cancel();
        }
      });

      director.say("Hello.");
      calls[0]?.result.resolve({
        expressionId: "happy",
        motion: { group: "Tap", index: 0 },
      });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });

    it("stops the motion when an expression listener starts a new line", async () => {
      const { director, calls, emissions, onEmit } = setup();
      onEmit(([event]) => {
        if (event === "avatar:expression" && calls.length === 1) {
          director.say("Next line.");
        }
      });

      director.say("Hello.");
      calls[0]?.result.resolve({
        expressionId: "happy",
        motion: { group: "Tap", index: 0 },
      });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
      expect(calls[1]?.text).toBe("Next line.");
    });
  });

  describe("done() without an open stream", () => {
    it("keeps the pending classification on a duplicate done()", async () => {
      const { director, calls, emissions } = setup();

      director.push("Hello.");
      director.done();
      director.done();
      calls[0]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(calls).toHaveLength(1);
      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });

    it("keeps the pending classification when say() is followed by done()", async () => {
      const { director, calls, emissions } = setup();

      director.say("Hello.");
      director.done();
      calls[0]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });
  });

  describe("abort listener", () => {
    it("does not overwrite a line an abort listener started during say()", async () => {
      const { director, calls, emissions } = setup();

      director.say("First.");
      calls[0]?.signal.addEventListener("abort", () => {
        director.say("Second.");
      });
      director.say("Third.");
      await flush();

      expect(calls.map((call) => call.text)).toEqual(["First.", "Second."]);
      calls[1]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });

    it("keeps a chunk an abort listener pushes during the first push()", async () => {
      const { director, calls } = setup();

      director.say("First.");
      calls[0]?.signal.addEventListener("abort", () => {
        director.push(" extra");
      });
      director.push("Hello");
      director.done();

      expect(calls[1]?.text).toBe("Hello extra");
    });

    it("keeps a line an abort listener starts during cancel()", async () => {
      const { director, calls, emissions } = setup();

      director.say("First.");
      calls[0]?.signal.addEventListener("abort", () => {
        director.say("Second.");
      });
      director.cancel();
      calls[1]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(calls[1]?.text).toBe("Second.");
      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });
  });

  describe("failure", () => {
    it("reports a rejecting classifier once, emits nothing, and recovers", async () => {
      const onError = vi.fn();
      const { director, calls, emissions } = setup({ onError });
      const failure = new Error("classifier down");

      expect(() => director.say("Hello.")).not.toThrow();
      calls[0]?.result.reject(failure);
      await flush();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(failure);
      expect(emissions).toEqual([]);

      director.say("Again.");
      calls[1]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "happy",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });

    it("reports a synchronously throwing classifier once, emits nothing, and recovers", async () => {
      const onError = vi.fn();
      const failure = new Error("bad input");
      let shouldThrow = true;
      const { director, emissions } = setup({
        onError,
        classifier: () => {
          if (shouldThrow) {
            throw failure;
          }
          return Promise.resolve({ expressionId: "sad" });
        },
      });

      expect(() => director.say("Hello.")).not.toThrow();
      await flush();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(failure);
      expect(emissions).toEqual([]);

      shouldThrow = false;
      director.say("Again.");
      await flush();

      expect(emissions).toEqual([
        [
          "avatar:expression",
          {
            expressionId: "sad",
            source: "avatar-director",
            priority: "inferred",
          },
        ],
      ]);
    });

    it("reports to console.warn without onError", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { director, calls } = setup();
      const failure = new Error("classifier down");

      director.say("Hello.");
      calls[0]?.result.reject(failure);
      await flush();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toContain(failure);
    });

    it("logs a throwing emitter without rejecting or calling onError", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onError = vi.fn();
      const failure = new Error("emitter broke");
      const director = createAvatarDirector({
        catalog: CATALOG,
        classifier: async () => ({ expressionId: "happy" }),
        emitter: {
          emit() {
            throw failure;
          },
        },
        onError,
      });

      director.say("Hello.");
      await flush();

      expect(onError).not.toHaveBeenCalled();
      expect(warn.mock.calls[0]).toContain(failure);
    });

    it("logs an async onError that rejects instead of leaving it unhandled", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const failure = new Error("onError broke");
      const { director, calls } = setup({
        onError: () => Promise.reject(failure) as unknown as void,
      });

      director.say("Hello.");
      calls[0]?.result.reject(new Error("classifier failed"));
      await flush();

      expect(warn.mock.calls[0]).toContain(failure);
    });

    it("does not report a rejection after the line was superseded", async () => {
      const onError = vi.fn();
      const { director, calls } = setup({ onError });

      director.say("First.");
      director.say("Second.");
      calls[0]?.result.reject(new DOMException("Aborted", "AbortError"));
      await flush();

      expect(onError).not.toHaveBeenCalled();
    });

    it("does not report a rejection after cancel()", async () => {
      const onError = vi.fn();
      const { director, calls } = setup({ onError });

      director.say("Hello.");
      director.cancel();
      calls[0]?.result.reject(new DOMException("Aborted", "AbortError"));
      await flush();

      expect(onError).not.toHaveBeenCalled();
    });
  });
});
