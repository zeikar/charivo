import { describe, expect, it, vi } from "vitest";
import { createCharivo } from "@charivo/core";
import type {
  AvatarControlCatalog,
  Character,
  Charivo,
  CharivoEventEmitter,
  EventMap,
  HistoryRollback,
  LLMManager,
  Message,
  TTSManager,
  TTSOptions,
} from "@charivo/core";
import {
  connectAvatarDirectorToCascade,
  createAvatarDirector,
  type AvatarClassifier,
  type AvatarDecision,
} from "@charivo/avatar";

const CATALOG: AvatarControlCatalog = {
  expressions: ["happy", "sad"],
  motions: { Idle: 2 },
};

const CHARACTER: Character = { id: "hiyori", name: "Hiyori" };

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

class StubLLMManager implements LLMManager {
  setCharacter = vi.fn((_character: Character) => undefined);
  getCharacter = vi.fn((): Character | null => null);
  clearHistory = vi.fn(() => undefined);
  getHistory = vi.fn((): Message[] => []);
  addToHistory = vi.fn(
    (_message: Message): HistoryRollback =>
      () =>
        undefined,
  );
  generateResponse = vi.fn(async (_message: Message) => "Nice to meet you!");
}

/** Emits no audio events, as a third-party manager may; speak() resolves at once unless a test overrides it. */
class StubTTSManager implements TTSManager {
  speak = vi.fn(async (_text: string, _options?: TTSOptions) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type AvatarEmission =
  | ["avatar:expression", EventMap["avatar:expression"]]
  | ["avatar:motion", EventMap["avatar:motion"]];

function setup(options: { llm?: LLMManager; tts?: TTSManager } = {}) {
  const charivo: Charivo = createCharivo({
    llm: options.llm,
    tts: options.tts,
    character: CHARACTER,
  });
  const { classifier, calls } = createControlledClassifier();
  const director = createAvatarDirector({
    catalog: CATALOG,
    classifier,
    emitter: charivo,
  });
  const emissions: AvatarEmission[] = [];
  charivo.on("avatar:expression", (data) => {
    emissions.push(["avatar:expression", data]);
  });
  charivo.on("avatar:motion", (data) => {
    emissions.push(["avatar:motion", data]);
  });
  return { charivo, director, classifier, calls, emissions };
}

const LINE_ENDINGS: {
  [K in
    | "tts:audio:end"
    | "tts:end"
    | "tts:error"
    | "turn:cancelled"]: EventMap[K];
} = {
  "tts:audio:end": {},
  "tts:end": {},
  "tts:error": { error: new Error("playback failed") },
  "turn:cancelled": { userMessageId: "msg_1" },
};

function speak(charivo: Charivo, text: string): void {
  charivo.emit("tts:start", { text, characterId: CHARACTER.id });
}

describe("connectAvatarDirectorToCascade", () => {
  it("classifies tts:start and emits the decision on the same instance", async () => {
    const { charivo, director, classifier, calls, emissions } = setup();
    connectAvatarDirectorToCascade(charivo, director);

    speak(charivo, "Hello there!");

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(calls[0]?.text).toBe("Hello there!");

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

  it("emits the decision while userSay() is still speaking", async () => {
    const tts = new StubTTSManager();
    const speech = deferred<undefined>();
    tts.speak.mockImplementation(() => speech.promise);
    const { charivo, director, calls, emissions } = setup({
      llm: new StubLLMManager(),
      tts,
    });
    connectAvatarDirectorToCascade(charivo, director);

    const turn = charivo.userSay("Hi!");
    await flush();

    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(calls[0]?.text).toBe("Nice to meet you!");

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

    speech.resolve(undefined);
    await turn;
  });

  it("drops the decision once userSay() finishes speaking with no audio events", async () => {
    const tts = new StubTTSManager();
    const { charivo, director, classifier, calls, emissions } = setup({
      llm: new StubLLMManager(),
      tts,
    });
    connectAvatarDirectorToCascade(charivo, director);

    await charivo.userSay("Hi!");

    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(classifier).toHaveBeenCalledTimes(1);
    expect(calls[0]?.text).toBe("Nice to meet you!");

    calls[0]?.result.resolve({ expressionId: "happy" });
    await flush();

    expect(emissions).toEqual([]);
  });

  it("does not classify a turn whose renderer rejects", async () => {
    const { charivo, director, classifier } = setup({
      llm: new StubLLMManager(),
      tts: new StubTTSManager(),
    });
    charivo.attachRenderer({
      initialize: async () => undefined,
      destroy: async () => undefined,
      setCharacter: () => undefined,
      render: async (message) => {
        if (message.type === "character") {
          throw new Error("render failed");
        }
      },
      setLocalGaze: () => false,
      setEventBus: () => undefined,
      disconnect: () => undefined,
      loadModel: async () => undefined,
      setMessageCallback: () => undefined,
    });
    connectAvatarDirectorToCascade(charivo, director);

    await expect(charivo.userSay("Hi!")).rejects.toThrow("render failed");
    await flush();

    expect(classifier).not.toHaveBeenCalled();
  });

  it("skips a turn interrupted by an earlier tts:start listener", async () => {
    const { charivo, director, classifier, calls } = setup({
      llm: new StubLLMManager(),
      tts: new StubTTSManager(),
    });
    let interrupted: Promise<void> | undefined;
    charivo.on("tts:start", () => {
      interrupted ??= charivo.interrupt();
    });
    connectAvatarDirectorToCascade(charivo, director);

    await charivo.userSay("Hi!");
    await interrupted;

    expect(interrupted).toBeDefined();
    expect(classifier).not.toHaveBeenCalled();

    await charivo.userSay("Hi again!");

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(calls[0]?.text).toBe("Nice to meet you!");
  });

  it.each(Object.keys(LINE_ENDINGS) as Array<keyof typeof LINE_ENDINGS>)(
    "drops the pending decision on %s",
    async (event) => {
      const { charivo, director, calls, emissions } = setup();
      connectAvatarDirectorToCascade(charivo, director);

      speak(charivo, "Hello there!");
      charivo.emit(event, LINE_ENDINGS[event]);
      calls[0]?.result.resolve({ expressionId: "happy" });
      await flush();

      expect(emissions).toEqual([]);
    },
  );

  it("drops the pending decision and stops listening on disconnect", async () => {
    const { charivo, director, classifier, calls, emissions } = setup();
    const disconnect = connectAvatarDirectorToCascade(charivo, director);

    speak(charivo, "Hello there!");
    disconnect();
    calls[0]?.result.resolve({ expressionId: "happy" });
    await flush();
    speak(charivo, "Anyone there?");

    expect(emissions).toEqual([]);
    expect(classifier).toHaveBeenCalledTimes(1);
  });

  it("does not classify an event whose dispatch disconnected it", () => {
    const { charivo, director, classifier } = setup();
    let disconnect = () => {};
    charivo.on("tts:start", () => {
      disconnect();
    });
    disconnect = connectAvatarDirectorToCascade(charivo, director);

    speak(charivo, "Hello there!");

    expect(classifier).not.toHaveBeenCalled();
  });
});
