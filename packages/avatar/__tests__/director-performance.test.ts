import { describe, expect, it, vi } from "vitest";
import { createCharivo } from "@charivo/core";
import type { AvatarControlCatalog, EventMap } from "@charivo/core";
import {
  connectAvatarDirectorToPerformances,
  createAvatarDirector,
  type AvatarClassifier,
  type AvatarDecision,
} from "@charivo/avatar";

const CATALOG: AvatarControlCatalog = {
  expressions: ["happy", "sad"],
  motions: {},
};

function setup() {
  const charivo = createCharivo();
  const emissions: Array<EventMap["avatar:expression"]> = [];
  charivo.on("avatar:expression", (data) => {
    emissions.push(data);
  });
  const classifier = vi.fn<AvatarClassifier>(
    async (): Promise<AvatarDecision> => ({ expressionId: "happy" }),
  );
  const director = createAvatarDirector({
    catalog: CATALOG,
    classifier,
    emitter: charivo,
  });
  const disconnect = connectAvatarDirectorToPerformances(charivo, director);
  return { charivo, classifier, emissions, disconnect };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("connectAvatarDirectorToPerformances", () => {
  it("classifies a voiced performance's text once, bound to its id", async () => {
    const { charivo, classifier, emissions } = setup();

    charivo.emit("performance:start", {
      performanceId: "p1",
      origin: "cascade",
      voiced: true,
      text: "Hello!",
      affectResolved: false,
    });
    await flush();

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(classifier.mock.calls[0]?.[0].text).toBe("Hello!");
    expect(emissions).toEqual([
      {
        expressionId: "happy",
        source: "avatar-director",
        priority: "inferred",
        hold: { performance: "p1" },
      },
    ]);
  });

  it("classifies when affectResolved is absent", () => {
    const { charivo, classifier } = setup();

    charivo.emit("performance:start", {
      performanceId: "p1",
      origin: "cascade",
      voiced: true,
      text: "Hello!",
    });

    expect(classifier).toHaveBeenCalledTimes(1);
  });

  it("does not classify when affect resolved", () => {
    const { charivo, classifier } = setup();

    charivo.emit("performance:start", {
      performanceId: "p1",
      origin: "cascade",
      voiced: true,
      text: "Hello!",
      affectResolved: true,
    });

    expect(classifier).not.toHaveBeenCalled();
  });

  it("does not classify an unvoiced performance", () => {
    const { charivo, classifier } = setup();

    charivo.emit("performance:start", {
      performanceId: "p1",
      origin: "cascade",
      voiced: false,
      text: "Hello!",
      affectResolved: false,
    });

    expect(classifier).not.toHaveBeenCalled();
  });

  it("classifies each segment of a voiced stream with the performance id", async () => {
    const { charivo, classifier, emissions } = setup();

    charivo.emit("performance:start", {
      performanceId: "s1",
      origin: "cascade",
      voiced: true,
      affectResolved: false,
    });
    expect(classifier).not.toHaveBeenCalled();

    charivo.emit("performance:segment", {
      performanceId: "s1",
      origin: "cascade",
      index: 0,
      text: "First.",
    });
    charivo.emit("performance:segment", {
      performanceId: "s1",
      origin: "cascade",
      index: 1,
      text: "Second.",
    });
    await flush();

    expect(classifier.mock.calls.map((call) => call[0].text)).toEqual([
      "First.",
      "Second.",
    ]);
    // The first line was superseded before its decision applied.
    expect(emissions).toEqual([
      {
        expressionId: "happy",
        source: "avatar-director",
        priority: "inferred",
        hold: { performance: "s1" },
      },
    ]);
  });

  it("ignores segments of a stream whose affect resolved, an unvoiced stream or another performance", () => {
    const { charivo, classifier } = setup();
    const segment = (performanceId: string) =>
      charivo.emit("performance:segment", {
        performanceId,
        origin: "cascade",
        index: 0,
        text: "Hi.",
      });

    charivo.emit("performance:start", {
      performanceId: "resolved",
      origin: "cascade",
      voiced: true,
      affectResolved: true,
    });
    segment("resolved");
    charivo.emit("performance:start", {
      performanceId: "quiet",
      origin: "cascade",
      voiced: false,
      affectResolved: false,
    });
    segment("quiet");
    segment("stranger");

    expect(classifier).not.toHaveBeenCalled();
  });

  it("drops the pending decision when the current performance ends", async () => {
    const { charivo, emissions } = setup();

    charivo.emit("performance:start", {
      performanceId: "p1",
      origin: "cascade",
      voiced: true,
      text: "Hello!",
    });
    charivo.emit("performance:end", {
      performanceId: "p1",
      origin: "cascade",
      status: "cancelled",
    });
    await flush();

    expect(emissions).toEqual([]);
  });

  it("keeps the pending decision when another performance ends", async () => {
    const { charivo, emissions } = setup();

    charivo.emit("performance:start", {
      performanceId: "p1",
      origin: "cascade",
      voiced: true,
      text: "Hello!",
    });
    charivo.emit("performance:end", {
      performanceId: "other",
      origin: "app",
      status: "completed",
    });
    await flush();

    expect(emissions).toHaveLength(1);
  });

  it("disconnects and drops the pending decision", async () => {
    const { charivo, classifier, emissions, disconnect } = setup();

    charivo.emit("performance:start", {
      performanceId: "p1",
      origin: "cascade",
      voiced: true,
      text: "Hello!",
    });
    disconnect();
    await flush();
    charivo.emit("performance:start", {
      performanceId: "p2",
      origin: "cascade",
      voiced: true,
      text: "Again!",
    });
    await flush();

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(emissions).toEqual([]);
  });
});
