import { describe, expect, it, vi } from "vitest";
import {
  CharivoProviderError,
  CharivoStateError,
  createCharivo,
} from "@charivo/core";
import type {
  BrainInput,
  BrainTurn,
  Character,
  CharivoEventEmitter,
  LLMClient,
  LLMMessage,
  LLMToolResponse,
  Message,
  RealtimeManager,
  RealtimeState,
  ToolDefinition,
  ToolRegistration,
  TTSManager,
} from "@charivo/core";
import {
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";
import {
  createCascadeBrain,
  createLLMManager,
  type CascadeReply,
  type CascadeReviewInput,
} from "@charivo/llm";
import {
  GateableLLMClient,
  RecordingLLMManager,
  SignalRecordingLLMManager,
  buildMessage,
  character,
  createDeferred,
  createHarness,
  lastContentOf,
  transcript,
  type Harness,
  type HarnessOptions,
} from "./cascade-brain-harness";

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
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);
}

/** Asks for the `ping` tool once per request, then answers with text. */
class ToolCallingClient implements LLMClient {
  private seq = 0;

  call = vi.fn(async (_messages: LLMMessage[]) => "plain");
  callWithTools = vi.fn(
    async (messages: LLMMessage[]): Promise<LLMToolResponse> => {
      if (messages[messages.length - 1]?.role === "tool") {
        return { content: "after-tool" };
      }
      this.seq += 1;
      return {
        content: "",
        toolCalls: [{ id: `call-${this.seq}`, name: "ping", arguments: {} }],
      };
    },
  );
}

const pingTool: ToolRegistration = {
  definition: {
    type: "function",
    name: "ping",
    description: "Answers pong",
    parameters: { type: "object", properties: {} },
  },
  handler: async () => ({ pong: true }),
};

function userMessage(content: string): Message {
  return {
    id: `direct-${content}`,
    content,
    timestamp: new Date(),
    type: "user",
  };
}

/** The history part of a request: everything but the system prompt. */
function promptContents(prompt: LLMMessage[]): string[] {
  return prompt
    .filter((message) => message.role !== "system")
    .map((message) => message.content);
}

/** The recorder's announcements and cancellations, in order. */
function sentAndCancelled(log: string[]): string[] {
  return log.filter(
    (entry) => entry.startsWith("sent:") || entry.startsWith("cancelled:"),
  );
}

describe("cascade brain: a completed turn", () => {
  it("announces the input, requests, announces the reply and performs it", async () => {
    const { charivo, brain, client, recorder } = createHarness({ tts: true });
    client.responder = (content) => {
      recorder.log.push(`request:${content}`);
      return `reply-${content}`;
    };
    const sentIds: string[] = [];
    charivo.on("message:sent", ({ message }) => sentIds.push(message.id));

    const turn = brain.submit({ kind: "user", text: "A" });

    await expect(turn.done).resolves.toEqual({
      status: "completed",
      text: "reply-A",
      heardText: "reply-A",
    });
    expect(recorder.log).toEqual([
      "sent:A",
      "request:A",
      "received:reply-A",
      "start:cascade:reply-A",
      "end:cascade:completed",
    ]);
    expect(sentIds).toEqual([turn.id]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);
  });

  it("renders the reply and never the input", async () => {
    const { brain, render } = createHarness();

    await brain.submit({ kind: "user", text: "A" }).done;

    expect(render.rendered()).toEqual(["character:reply-A"]);
  });

  it("commits the reply only once its render has finished", async () => {
    const { brain, render, recorder } = createHarness({ tts: true });
    render.hold = (message) => message.content === "reply-A";

    const turn = brain.submit({ kind: "user", text: "A" });
    await render.waitForCalls(1);

    // performance:start has fired; the render is still in progress.
    expect(recorder.log).toContain("start:cascade:reply-A");
    expect(transcript(brain.getHistory())).toEqual(["user:A"]);

    render.settle();
    await turn.done;

    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);
  });
});

describe("cascade brain: failures", () => {
  it("fails at generate with a typed provider error and rolls the input back", async () => {
    const { brain, client, recorder } = createHarness();
    client.responder = () => {
      throw new Error("upstream failed");
    };

    const result = await brain.submit({ kind: "user", text: "A" }).done;

    expect(result).toMatchObject({ status: "failed", stage: "generate" });
    expect(result.status === "failed" && result.error).toBeInstanceOf(
      CharivoProviderError,
    );
    expect(brain.getHistory()).toEqual([]);
    expect(recorder.log).toEqual(["sent:A"]);
  });

  it("restores a bound-full history when generation fails", async () => {
    const { brain, client } = createHarness({
      renderer: false,
      maxHistoryTurns: 1,
    });
    await brain.submit({ kind: "user", text: "one" }).done;

    client.responder = () => {
      throw new Error("upstream failed");
    };

    await expect(
      brain.submit({ kind: "user", text: "two" }).done,
    ).resolves.toMatchObject({ status: "failed", stage: "generate" });
    expect(transcript(brain.getHistory())).toEqual([
      "user:one",
      "character:reply-one",
    ]);
  });

  it("fails at render with the input kept and the reply dropped", async () => {
    const { brain, render, tts } = createHarness({ tts: true });
    render.hold = (message) => message.content === "reply-A";

    const turn = brain.submit({ kind: "user", text: "A" });
    await render.waitForCalls(1);
    render.fail(new Error("render boom"));

    const result = await turn.done;
    expect(result).toMatchObject({
      status: "failed",
      stage: "render",
      text: "reply-A",
    });
    expect(result.status === "failed" && result.error).toBeInstanceOf(
      CharivoStateError,
    );
    expect(transcript(brain.getHistory())).toEqual(["user:A"]);
    expect(tts.speak).not.toHaveBeenCalled();
  });

  it("fails at tts with the reply kept", async () => {
    const { brain, tts } = createHarness({ renderer: false, tts: true });
    tts.speak.mockRejectedValueOnce(new Error("tts failed"));

    const result = await brain.submit({ kind: "user", text: "A" }).done;

    expect(result).toMatchObject({
      status: "failed",
      stage: "tts",
      text: "reply-A",
    });
    expect(result.status === "failed" && result.error).toBeInstanceOf(
      CharivoProviderError,
    );
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);
  });

  it("stores and performs an empty reply", async () => {
    const { brain, client, tts, recorder } = createHarness({
      renderer: false,
      tts: true,
    });
    client.responder = () => "";

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toEqual({ status: "completed", text: "", heardText: "" });
    expect(recorder.log).toContain("received:");
    expect(tts.spokenTexts()).toEqual([""]);
    expect(transcript(brain.getHistory())).toEqual(["user:A", "character:"]);
  });

  it("fails at tts with the reply uncommitted when realtime holds playback", async () => {
    const { charivo, brain, client, recorder } = createHarness({ tts: true });
    client.responder = () => null;

    const turn = brain.submit({ kind: "user", text: "A" });
    await client.waitForCalls(1);
    charivo.attachRealtime(new StubRealtimeManager());
    client.resolveCall("A", "reply-A");

    const result = await turn.done;
    expect(result).toMatchObject({
      status: "failed",
      stage: "tts",
      text: "reply-A",
    });
    expect(result.status === "failed" && result.error).toBeInstanceOf(
      CharivoStateError,
    );
    expect(transcript(brain.getHistory())).toEqual(["user:A"]);
    expect(recorder.log).toEqual(["sent:A", "received:reply-A"]);
  });
});

describe.each([
  { label: "with a render manager", renderer: true },
  { label: "without a render manager", renderer: false },
])("cascade brain: the commit boundary $label", ({ renderer }) => {
  it("has the reply in history before speak() is called", async () => {
    const { brain, tts } = createHarness({ renderer, tts: true });
    const historyAtSpeak: string[][] = [];
    tts.onSpeak = () => historyAtSpeak.push(transcript(brain.getHistory()));

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toMatchObject({ status: "completed" });

    expect(historyAtSpeak).toEqual([["user:A", "character:reply-A"]]);
  });

  it("fails at generate with the reply unspoken and unstored when the commit throws", async () => {
    const { brain, tts, manager, recorder } = createHarness({
      renderer,
      tts: true,
    });
    const addToHistory = manager.addToHistory.bind(manager);
    vi.spyOn(manager, "addToHistory").mockImplementation((message, options) => {
      if (message.type === "character") {
        throw new Error("commit boom");
      }
      return addToHistory(message, options);
    });

    const result = await brain.submit({ kind: "user", text: "A" }).done;

    expect(result).toMatchObject({ status: "failed", stage: "generate" });
    expect(result.status === "failed" && result.error).toBeInstanceOf(
      CharivoProviderError,
    );
    expect(tts.speak).not.toHaveBeenCalled();
    expect(transcript(brain.getHistory())).toEqual(["user:A"]);
    expect(recorder.log).toContain("end:cascade:cancelled");
  });
});

describe.each([
  { event: "performance:end" as const },
  { event: "floor:changed" as const },
])("cascade brain: the next input submitted from $event", ({ event }) => {
  /** Submits "B" once, from the end of the first performance. */
  function chainNext(harness: ReturnType<typeof createHarness>): BrainTurn[] {
    const chained: BrainTurn[] = [];
    const submitNext = () => {
      if (chained.length === 0) {
        chained.push(harness.brain.submit({ kind: "user", text: "B" }));
      }
    };
    if (event === "performance:end") {
      harness.charivo.on("performance:end", submitNext);
    } else {
      harness.charivo.on("floor:changed", ({ floor }) => {
        if (floor.state === "idle") {
          submitNext();
        }
      });
    }
    return chained;
  }

  it("leaves the finished turn completed", async () => {
    const harness = createHarness({ tts: true });
    const chained = chainNext(harness);

    const first = await harness.brain.submit({ kind: "user", text: "A" }).done;

    expect(first).toEqual({
      status: "completed",
      text: "reply-A",
      heardText: "reply-A",
    });
    expect(chained).toHaveLength(1);
    await expect(chained[0]!.done).resolves.toMatchObject({
      status: "completed",
      text: "reply-B",
    });
    expect(harness.recorder.cancelled).toEqual([]);
    expect(transcript(harness.brain.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
      "user:B",
      "character:reply-B",
    ]);
  });

  it("leaves a turn whose speech failed failed at tts", async () => {
    const harness = createHarness({ tts: true });
    harness.tts.speak.mockRejectedValueOnce(new Error("tts failed"));
    const chained = chainNext(harness);

    const first = await harness.brain.submit({ kind: "user", text: "A" }).done;

    expect(first).toMatchObject({
      status: "failed",
      stage: "tts",
      text: "reply-A",
    });
    expect(chained).toHaveLength(1);
  });
});

describe("cascade brain: a turn submitted while one is retired", () => {
  it("lets a turn submitted from the retired performance's end win", async () => {
    const { charivo, brain, tts, client, recorder } = createHarness({
      renderer: false,
      tts: true,
    });
    tts.holdSpeak = (text) => text === "reply-A";
    const turnA = brain.submit({ kind: "user", text: "A" });
    await tts.waitForSpeaks(1);

    let started = false;
    let turnN: BrainTurn | undefined;
    charivo.on("performance:end", () => {
      if (started) return;
      started = true;
      turnN = brain.submit({ kind: "user", text: "N" });
    });
    const turnO = brain.submit({ kind: "user", text: "O" });

    await expect(turnN!.done).resolves.toMatchObject({
      status: "completed",
      text: "reply-N",
    });
    await expect(turnO.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnA.done).resolves.toEqual({
      status: "cancelled",
      text: "reply-A",
      heardText: "",
    });
    expect(client.calledFor("O")).toBe(false);
    // Call order, and the unheard reply rolled back before N's request.
    expect(promptContents(client.promptFor("N"))).toEqual(["A", "O", "N"]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:O",
      "user:N",
      "character:reply-N",
    ]);
    expect(sentAndCancelled(recorder.log)).toEqual([
      "sent:A",
      "sent:O",
      "sent:N",
      "cancelled:O",
      "cancelled:A",
    ]);
  });

  it("lets a turn:cancelled listener's submit win over a turn an app perform() cut", async () => {
    const { charivo, brain, tts, client, recorder } = createHarness({
      renderer: false,
      tts: true,
    });
    tts.holdSpeak = (text) => text === "reply-A";
    const turnA = brain.submit({ kind: "user", text: "A" });
    await tts.waitForSpeaks(1);

    let started = false;
    let turnN: BrainTurn | undefined;
    charivo.on("turn:cancelled", () => {
      if (started) return;
      started = true;
      turnN = brain.submit({ kind: "user", text: "N" });
    });
    charivo.perform({ text: "app line" });
    const turnO = brain.submit({ kind: "user", text: "O" });

    await expect(turnN!.done).resolves.toMatchObject({ status: "completed" });
    await expect(turnO.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    expect(client.calledFor("O")).toBe(false);
    expect(promptContents(client.promptFor("N"))).toEqual(["A", "O", "N"]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:O",
      "user:N",
      "character:reply-N",
    ]);
    expect(sentAndCancelled(recorder.log)).toEqual([
      "sent:A",
      "sent:O",
      "cancelled:A",
      "sent:N",
      "cancelled:O",
    ]);
  });
});

describe("cascade brain: the manager and the body", () => {
  it("forwards a tool event raised by the manager to the attached body", async () => {
    const manager = createLLMManager(new ToolCallingClient(), {
      tools: [pingTool],
    });
    const { charivo, brain } = createHarness({ manager });
    const toolEvents: string[] = [];
    charivo.on("tool:call", ({ name }) => toolEvents.push(`call:${name}`));
    charivo.on("tool:result", ({ name }) => toolEvents.push(`result:${name}`));

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toMatchObject({ status: "completed", text: "after-tool" });
    expect(toolEvents).toEqual(["call:ping", "result:ping"]);
  });

  it("sends tool events to the body attached at the time, and to no detached one", async () => {
    const manager = createLLMManager(new ToolCallingClient(), {
      tools: [pingTool],
    });
    const brain = createCascadeBrain(manager);
    const first = createCharivo({ brain, character });
    const firstEvents: string[] = [];
    first.on("tool:call", ({ name }) => firstEvents.push(name));

    first.detachBrain();
    await manager.generateResponse(userMessage("while detached"));
    expect(firstEvents).toEqual([]);

    const second = createCharivo({ brain, character });
    const secondEvents: string[] = [];
    second.on("tool:call", ({ name }) => secondEvents.push(name));
    await manager.generateResponse(userMessage("on the second body"));

    expect(secondEvents).toEqual(["ping"]);
    expect(firstEvents).toEqual([]);
  });

  it("passes setCharacter, clearHistory and getHistory to the manager", () => {
    const manager = new RecordingLLMManager();
    const history: Message[] = [userMessage("kept")];
    manager.getHistory.mockReturnValue(history);
    const brain = createCascadeBrain(manager);

    brain.setCharacter(character);
    brain.clearHistory();

    expect(manager.setCharacter).toHaveBeenCalledWith(character);
    expect(manager.clearHistory).toHaveBeenCalledTimes(1);
    expect(brain.getHistory()).toBe(history);
  });

  it("throws CharivoStateError from submit() with no body", () => {
    const brain = createCascadeBrain(new RecordingLLMManager());

    expect(() => brain.submit({ kind: "user", text: "A" })).toThrow(
      CharivoStateError,
    );
  });

  it("clears the history on dispose()", async () => {
    const { brain, manager } = createHarness();
    await brain.submit({ kind: "user", text: "A" }).done;
    expect(manager.getHistory()).toHaveLength(2);

    await brain.dispose?.();

    expect(manager.getHistory()).toEqual([]);
  });
});

describe("cascade brain: retention and ordering", () => {
  it("writes a superseded turn's input before announcing its cancellation", async () => {
    const { charivo, brain } = createHarness({ renderer: false });
    const snapshots: string[][] = [];
    charivo.on("turn:cancelled", () => {
      snapshots.push(transcript(brain.getHistory()));
    });
    // A is superseded inside its own announcement, before it writes anything.
    let turnB: BrainTurn | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content === "A" && !turnB) {
        turnB = brain.submit({ kind: "user", text: "B" });
      }
    });

    const turnA = brain.submit({ kind: "user", text: "A" });

    expect(snapshots).toEqual([["user:A"]]);
    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnB!.done).resolves.toMatchObject({ status: "completed" });
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:B",
      "character:reply-B",
    ]);
  });

  it("keeps history in call order when a message:sent listener starts a nested turn", async () => {
    const { charivo, brain, client, recorder } = createHarness({
      renderer: false,
    });
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;
    let turnC: BrainTurn | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content === "B" && !turnC) {
        turnC = brain.submit({ kind: "user", text: "C" });
      }
    });

    const turnA = brain.submit({ kind: "user", text: "A" });
    await client.waitForCalls(1);
    const turnB = brain.submit({ kind: "user", text: "B" });

    await expect(turnC!.done).resolves.toMatchObject({ status: "completed" });
    client.resolveCall("A", "reply-A");
    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnB.done).resolves.toMatchObject({ status: "cancelled" });

    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:B",
      "user:C",
      "character:reply-C",
    ]);
    expect(promptContents(client.promptFor("C"))).toEqual(["A", "B", "C"]);
    expect(client.calledFor("B")).toBe(false);
    expect(sentAndCancelled(recorder.log)).toEqual([
      "sent:A",
      "sent:B",
      "sent:C",
      "cancelled:B",
      "cancelled:A",
    ]);
  });

  it("keeps flushing to its own entry when the manager refuses an older queued input", async () => {
    const manager = new RecordingLLMManager();
    manager.addToHistory.mockImplementation((message: Message) => {
      manager.added.push(message);
      if (message.content === "A") {
        throw new CharivoStateError("refused");
      }
      return () => undefined;
    });
    const { charivo, brain, recorder } = createHarness({
      manager,
      renderer: false,
    });
    let turnC: BrainTurn | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content === "A" && !turnC) {
        turnC = brain.submit({ kind: "user", text: "C" });
      }
    });

    const turnA = brain.submit({ kind: "user", text: "A" });

    await expect(turnC!.done).resolves.toMatchObject({ status: "completed" });
    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    expect(manager.addedContents()).toEqual(["A", "C", "reply-C"]);
    expect(recorder.cancelled).toEqual(["A"]);
  });

  it("emits message:sent before any turn:cancelled naming that turn, and each once", async () => {
    const { charivo, brain, client, recorder } = createHarness({
      renderer: false,
    });
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;
    // The recorder registered first, so it sees each event before this
    // listener starts another turn from inside it.
    let started = false;
    let turnC: BrainTurn | undefined;
    charivo.on("turn:cancelled", () => {
      if (started) return;
      started = true;
      turnC = brain.submit({ kind: "user", text: "C" });
    });

    const turnA = brain.submit({ kind: "user", text: "A" });
    await client.waitForCalls(1);
    brain.submit({ kind: "user", text: "B" });

    await expect(turnC!.done).resolves.toMatchObject({ status: "completed" });
    client.resolveCall("A", "reply-A");
    await turnA.done;

    expect(sentAndCancelled(recorder.log)).toEqual([
      "sent:A",
      "sent:B",
      "cancelled:A",
      "sent:C",
      "cancelled:B",
    ]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:B",
      "user:C",
      "character:reply-C",
    ]);
  });

  it("announces a turn once however often it is cancelled", async () => {
    const { brain, tts, recorder } = createHarness({
      renderer: false,
      tts: true,
    });
    tts.holdSpeak = (text) => text === "reply-A";
    const turnA = brain.submit({ kind: "user", text: "A" });
    await tts.waitForSpeaks(1);

    await Promise.all([turnA.cancel(), turnA.cancel(), brain.interrupt()]);
    await brain.submit({ kind: "user", text: "B" }).done;

    expect(recorder.cancelled).toEqual(["A"]);
  });

  it("announces no cancellation for a turn that failed on its own", async () => {
    const { brain, client, recorder } = createHarness({ renderer: false });
    client.responder = () => {
      throw new Error("upstream failed");
    };
    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toMatchObject({ status: "failed", stage: "generate" });

    client.responder = (content) => `reply-${content}`;
    await brain.submit({ kind: "user", text: "B" }).done;

    expect(recorder.cancelled).toEqual([]);
  });

  it("announces no cancellation for sequential turns", async () => {
    const { brain, recorder } = createHarness({ tts: true });

    await brain.submit({ kind: "user", text: "A" }).done;
    await brain.submit({ kind: "user", text: "B" }).done;

    expect(recorder.cancelled).toEqual([]);
    expect(sentAndCancelled(recorder.log)).toEqual(["sent:A", "sent:B"]);
  });

  it("announces a superseded empty-content turn without storing it", async () => {
    const { charivo, brain, recorder } = createHarness({ renderer: false });
    let turnB: BrainTurn | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content === "" && !turnB) {
        turnB = brain.submit({ kind: "user", text: "B" });
      }
    });

    const turnA = brain.submit({ kind: "user", text: "" });

    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnB!.done).resolves.toMatchObject({ status: "completed" });
    expect(recorder.cancelled).toEqual([""]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:B",
      "character:reply-B",
    ]);
  });

  it("gives every message a unique id inside one frozen millisecond", async () => {
    const { charivo, brain } = createHarness({ renderer: false });
    const ids: string[] = [];
    charivo.on("message:sent", ({ message }) => ids.push(message.id));
    charivo.on("message:received", ({ message }) => ids.push(message.id));

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      await brain.submit({ kind: "user", text: "A" }).done;
      await brain.submit({ kind: "user", text: "B" }).done;
    } finally {
      nowSpy.mockRestore();
    }

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("keeps the bound after a cancellation without stranding a reply", async () => {
    const { brain, client, manager } = createHarness({
      renderer: false,
      maxHistoryTurns: 1,
    });
    manager.addToHistory(buildMessage("prior", "user"));
    manager.addToHistory(buildMessage("reply-prior", "character"));
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;

    const turnA = brain.submit({ kind: "user", text: "A" });
    await client.waitForCalls(1);
    expect(transcript(brain.getHistory())).toEqual(["user:A"]);

    await brain.submit({ kind: "user", text: "B" }).done;
    client.resolveCall("A", "reply-A");
    await turnA.done;

    expect(transcript(brain.getHistory())).toEqual([
      "user:B",
      "character:reply-B",
    ]);
  });
});

describe("cascade brain: a turn superseded in each phase", () => {
  interface Phase {
    name: string;
    /** Parks A in this phase, or calls `supersede` from inside it. */
    arm: (harness: Harness, supersede: () => void) => void;
    /** Resolves once A is parked; absent when `arm` supersedes from inside. */
    reached?: (harness: Harness) => Promise<void>;
    settle?: (harness: Harness, outcome: "resolve" | "reject") => void;
    /** What A had done when it was superseded. */
    generates: boolean;
    received: boolean;
    started: boolean;
    spoke: boolean;
  }

  const failure = new Error("phase failure");

  const phases: Phase[] = [
    {
      name: "generation",
      arm: ({ client }) => {
        client.responder = (content) =>
          content === "A" ? null : `reply-${content}`;
      },
      reached: ({ client }) => client.waitForCalls(1),
      settle: ({ client }, outcome) =>
        outcome === "resolve"
          ? client.resolveCall("A", "reply-A")
          : client.rejectCall("A", failure),
      generates: true,
      received: false,
      started: false,
      spoke: false,
    },
    {
      name: "message:received",
      arm: ({ charivo }, supersede) => {
        charivo.on("message:received", ({ message }) => {
          if (message.content === "reply-A") supersede();
        });
      },
      generates: true,
      received: true,
      started: false,
      spoke: false,
    },
    {
      name: "the performance's render",
      arm: ({ render }) => {
        render.hold = (message) => message.content === "reply-A";
      },
      reached: ({ render }) => render.waitForCalls(1),
      settle: ({ render }, outcome) =>
        outcome === "resolve" ? render.settle() : render.fail(failure),
      generates: true,
      received: true,
      started: true,
      spoke: false,
    },
    {
      name: "speech",
      arm: ({ tts }) => {
        tts.holdSpeak = (text) => text === "reply-A";
      },
      reached: ({ tts }) => tts.waitForSpeaks(1),
      settle: ({ tts }, outcome) =>
        outcome === "resolve"
          ? tts.settleSpeak((text) => text === "reply-A")
          : tts.failSpeak((text) => text === "reply-A", failure),
      generates: true,
      received: true,
      started: true,
      spoke: true,
    },
  ];

  const cases = phases.flatMap(
    (
      phase,
    ): Array<{ phase: Phase; outcome?: "resolve" | "reject"; how: string }> =>
      phase.settle
        ? (["resolve", "reject"] as const).map((outcome) => ({
            phase,
            outcome,
            how: outcome === "resolve" ? "then resolved" : "then rejected",
          }))
        : [{ phase, how: "from inside it" }],
  );

  it.each(cases)(
    "abandons a turn superseded during $phase.name, $how",
    async ({ phase, outcome }) => {
      const harness = createHarness({ tts: true });
      const { brain, render, tts, client, recorder } = harness;
      let turnB: BrainTurn | undefined;
      const supersede = () => {
        turnB ??= brain.submit({ kind: "user", text: "B" });
      };
      phase.arm(harness, supersede);

      const turnA = brain.submit({ kind: "user", text: "A" });
      if (phase.reached) {
        await phase.reached(harness);
        supersede();
      }
      if (outcome) {
        phase.settle!(harness, outcome);
      }

      await expect(turnA.done).resolves.toMatchObject({
        status: "cancelled",
      });
      await expect(turnB!.done).resolves.toMatchObject({
        status: "completed",
        text: "reply-B",
      });

      const count = (entry: string) =>
        recorder.log.filter((logged) => logged === entry).length;
      expect(recorder.cancelled).toEqual(["A"]);
      expect(count("received:reply-A")).toBe(phase.received ? 1 : 0);
      expect(count("start:cascade:reply-A")).toBe(phase.started ? 1 : 0);
      expect(count("end:cascade:cancelled")).toBe(phase.started ? 1 : 0);
      expect(count("end:cascade:completed")).toBe(1);
      expect(client.calledFor("A")).toBe(phase.generates);
      expect(render.rendered().includes("character:reply-A")).toBe(
        phase.started,
      );
      expect(tts.spokenTexts()).toEqual(
        phase.spoke ? ["reply-A", "reply-B"] : ["reply-B"],
      );
      // The unheard reply was rolled back before B's request was built.
      expect(promptContents(client.promptFor("B"))).toEqual(["A", "B"]);
      // The input stays; a reply nobody heard does not.
      expect(transcript(brain.getHistory())).toEqual([
        "user:A",
        "user:B",
        "character:reply-B",
      ]);
    },
  );
});

describe("cascade brain: the superseded request", () => {
  function signalHarness(): {
    charivo: Harness["charivo"];
    brain: Harness["brain"];
    manager: SignalRecordingLLMManager;
    recorder: Harness["recorder"];
  } {
    const manager = new SignalRecordingLLMManager();
    const { charivo, brain, recorder } = createHarness({
      manager,
      renderer: false,
    });
    return { charivo, brain, manager, recorder };
  }

  it("aborts the request signal of a turn superseded during generation", async () => {
    const { brain, manager } = signalHarness();
    manager.hold = (content) => content === "A";

    const turnA = brain.submit({ kind: "user", text: "A" });
    await manager.waitForCalls(1);
    await brain.submit({ kind: "user", text: "B" }).done;

    expect(manager.signalFor("A")?.aborted).toBe(true);
    expect(manager.signalFor("B")?.aborted).toBe(false);
    manager.settleCall("A", "reply-A");
    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
  });

  it("settles cancelled when the request rejects with its abort reason", async () => {
    const { brain, manager, recorder } = signalHarness();
    manager.hold = (content) => content === "A";

    const turnA = brain.submit({ kind: "user", text: "A" });
    await manager.waitForCalls(1);
    await brain.submit({ kind: "user", text: "B" }).done;

    const reason = manager.signalFor("A")?.reason as Error | undefined;
    expect(reason?.name).toBe("AbortError");
    manager.rejectCall("A", reason);

    await expect(turnA.done).resolves.toEqual({
      status: "cancelled",
      text: "",
    });
    expect(recorder.cancelled).toEqual(["A"]);
  });

  it("never aborts the signal of a turn that runs to completion", async () => {
    const { brain, manager } = signalHarness();

    await brain.submit({ kind: "user", text: "A" }).done;
    await brain.submit({ kind: "user", text: "B" }).done;

    expect(manager.signalFor("A")?.aborted).toBe(false);
    expect(manager.signalFor("B")?.aborted).toBe(false);
  });

  it("aborts a superseded turn only once the newer turn is announced and queued", async () => {
    const { brain, manager, recorder } = signalHarness();
    manager.hold = (content) => content === "A";

    const turnA = brain.submit({ kind: "user", text: "A" });
    await manager.waitForCalls(1);
    let observed: string[] | undefined;
    let turnC: BrainTurn | undefined;
    manager.signalFor("A")!.addEventListener("abort", () => {
      observed = [...recorder.log];
      turnC = brain.submit({ kind: "user", text: "C" });
    });

    const turnB = brain.submit({ kind: "user", text: "B" });

    await expect(turnC!.done).resolves.toMatchObject({ status: "completed" });
    await expect(turnB.done).resolves.toMatchObject({ status: "cancelled" });
    manager.settleCall("A", "reply-A");
    await turnA.done;

    expect(observed).toEqual(["sent:A", "sent:B"]);
    expect(sentAndCancelled(recorder.log)).toEqual([
      "sent:A",
      "sent:B",
      "sent:C",
      "cancelled:B",
      "cancelled:A",
    ]);
    // C entered from the abort listener, so its input queued behind B's.
    expect(manager.addedContents()).toEqual(["A", "B", "C", "reply-C"]);
  });

  it("skips the tool handler of a turn superseded from tool:call", async () => {
    const handlerCalls: Array<string | undefined> = [];
    const tool: ToolRegistration = {
      definition: {
        type: "function",
        name: "toy",
        description: "records that it ran",
        parameters: { type: "object", properties: {} },
      },
      handler: vi.fn(async (_args, context) => {
        handlerCalls.push(context.callId);
        return { ok: true };
      }),
    };
    let round = 0;
    const client: LLMClient = {
      call: vi.fn(async () => "unused"),
      callWithTools: vi.fn(
        async (_messages: LLMMessage[], tools: ToolDefinition[]) => {
          round += 1;
          if (tools.length > 0 && round <= 2) {
            return {
              content: `round-${round}`,
              toolCalls: [{ id: `call-${round}`, name: "toy", arguments: {} }],
            };
          }
          return { content: "final", toolCalls: [] };
        },
      ),
    };
    const { charivo, brain } = createHarness({
      manager: createLLMManager(client, { tools: [tool] }),
      renderer: false,
    });
    let turnB: BrainTurn | undefined;
    charivo.on("tool:call", () => {
      turnB ??= brain.submit({ kind: "user", text: "B" });
    });

    const turnA = brain.submit({ kind: "user", text: "A" });

    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnB!.done).resolves.toMatchObject({ status: "completed" });
    // call-1 belongs to the superseded turn: announced, never executed.
    expect(handlerCalls).toEqual(["call-2"]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:B",
      "character:final",
    ]);
  });
});

describe.each([{ method: "brain.interrupt()" }, { method: "turn.cancel()" }])(
  "cascade brain: $method",
  ({ method }) => {
    const cancel = (harness: Harness, turn: BrainTurn) =>
      method === "brain.interrupt()"
        ? harness.brain.interrupt()
        : turn.cancel();

    it("cancels the generating turn", async () => {
      const manager = new SignalRecordingLLMManager();
      manager.hold = (content) => content === "A";
      const harness = createHarness({ manager, renderer: false });

      const turnA = harness.brain.submit({ kind: "user", text: "A" });
      await manager.waitForCalls(1);
      await expect(cancel(harness, turnA)).resolves.toBeUndefined();

      expect(manager.signalFor("A")?.aborted).toBe(true);
      expect(harness.recorder.cancelled).toEqual(["A"]);
      await expect(turnA.done).resolves.toEqual({
        status: "cancelled",
        text: "",
      });
      manager.settleCall("A", "reply-A");
      await Promise.resolve();
      expect(harness.recorder.log).not.toContain("received:reply-A");
      // The input stays.
      expect(manager.addedContents()).toEqual(["A"]);
    });

    it("resolves only once the performance's stop has", async () => {
      const harness = createHarness({ renderer: false, tts: true });
      const { tts, recorder } = harness;
      tts.holdSpeak = (text) => text === "reply-A";
      tts.holdStop = (index) => index === 0;
      const turnA = harness.brain.submit({ kind: "user", text: "A" });
      await tts.waitForSpeaks(1);

      let settled = false;
      const cancelling = cancel(harness, turnA).then(() => {
        settled = true;
      });
      await tts.waitForStops(1);

      // The cancellation itself is synchronous; only the stop is outstanding.
      expect(recorder.cancelled).toEqual(["A"]);
      await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
      expect(settled).toBe(false);

      tts.settleStop(0);
      await cancelling;
      expect(settled).toBe(true);
    });

    it("rejects with a typed error when the stop fails, after the turn is cancelled", async () => {
      const harness = createHarness({ renderer: false, tts: true });
      const { tts, recorder } = harness;
      tts.holdSpeak = (text) => text === "reply-A";
      const turnA = harness.brain.submit({ kind: "user", text: "A" });
      await tts.waitForSpeaks(1);
      tts.stop.mockRejectedValueOnce(new Error("stop failed"));

      await expect(cancel(harness, turnA)).rejects.toBeInstanceOf(
        CharivoProviderError,
      );
      expect(recorder.cancelled).toEqual(["A"]);
      await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    });

    it("does nothing for a finished turn", async () => {
      const harness = createHarness({ renderer: false, tts: true });
      const turnA = harness.brain.submit({ kind: "user", text: "A" });
      await expect(turnA.done).resolves.toMatchObject({ status: "completed" });

      await expect(cancel(harness, turnA)).resolves.toBeUndefined();

      expect(harness.tts.stop).not.toHaveBeenCalled();
      expect(harness.recorder.cancelled).toEqual([]);
      expect(transcript(harness.brain.getHistory())).toEqual([
        "user:A",
        "character:reply-A",
      ]);
    });
  },
);

describe("cascade brain: a cancelled reply", () => {
  it("is removed from history when cancelled before tts:audio:start", async () => {
    const { brain, tts } = createHarness({ renderer: false, tts: true });
    tts.holdSpeak = (text) => text === "reply-A";
    const turnA = brain.submit({ kind: "user", text: "A" });
    await tts.waitForSpeaks(1);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);

    await brain.interrupt();

    await expect(turnA.done).resolves.toEqual({
      status: "cancelled",
      text: "reply-A",
      heardText: "",
    });
    expect(transcript(brain.getHistory())).toEqual(["user:A"]);
  });

  it("stays in history when its manager cannot report audio start", async () => {
    const speaking = createDeferred();
    let finishSpeech = () => {};
    // No setEventEmitter: once asked to speak, it may have been heard.
    const tts: TTSManager = {
      speak: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishSpeech = resolve;
            speaking.resolve();
          }),
      ),
      stop: vi.fn(async () => finishSpeech()),
      setVoice: vi.fn(),
      isSupported: vi.fn(() => true),
    };
    const brain = createCascadeBrain(createLLMManager(new GateableLLMClient()));
    createCharivo({ brain, tts, character });

    const turnA = brain.submit({ kind: "user", text: "A" });
    await speaking.promise;
    await brain.interrupt();

    await expect(turnA.done).resolves.toEqual({
      status: "cancelled",
      text: "reply-A",
    });
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);
  });

  it("settles cancelled with one turn:cancelled when an app perform() cuts it", async () => {
    const { charivo, brain, tts, recorder } = createHarness({
      renderer: false,
      tts: true,
    });
    tts.holdSpeak = (text) => text === "reply-A";
    const turnA = brain.submit({ kind: "user", text: "A" });
    await tts.waitForSpeaks(1);

    const line = charivo.perform({ text: "app line" });

    await expect(turnA.done).resolves.toEqual({
      status: "cancelled",
      text: "reply-A",
      heardText: "",
    });
    expect(recorder.cancelled).toEqual(["A"]);
    await expect(line.done).resolves.toMatchObject({ status: "completed" });
    await brain.submit({ kind: "user", text: "B" }).done;
    expect(recorder.cancelled).toEqual(["A"]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:B",
      "character:reply-B",
    ]);
  });

  it("fails the newer turn at tts when the retired performance's stop rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { brain, tts } = createHarness({ renderer: false, tts: true });
      tts.holdSpeak = (text) => text === "reply-A";
      brain.submit({ kind: "user", text: "A" });
      await tts.waitForSpeaks(1);
      tts.stop.mockRejectedValueOnce(new Error("stop failed"));

      const result = await brain.submit({ kind: "user", text: "B" }).done;

      expect(result).toMatchObject({
        status: "failed",
        stage: "tts",
        text: "reply-B",
      });
      expect(result.status === "failed" && result.error).toBeInstanceOf(
        CharivoProviderError,
      );
      expect(tts.spokenTexts()).toEqual(["reply-A"]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("cascade brain: the order of an unheard reply's rollback", () => {
  /**
   * History `[one, reply-one, A, reply-A]` at a bound of two turns, with A's
   * reply speaking unheard and its stop held pending.
   */
  async function speakingA(): Promise<Harness> {
    const harness = createHarness({
      renderer: false,
      tts: true,
      maxHistoryTurns: 2,
    });
    const { brain, tts, client } = harness;
    await brain.submit({ kind: "user", text: "one" }).done;
    tts.holdSpeak = (text) => text === "reply-A";
    tts.holdStop = () => true;
    brain.submit({ kind: "user", text: "A" });
    await tts.waitForSpeaks(2);
    expect(transcript(brain.getHistory())).toEqual([
      "user:one",
      "character:reply-one",
      "user:A",
      "character:reply-A",
    ]);
    client.responder = (content) =>
      content === "one" || content === "A" ? `reply-${content}` : null;
    return harness;
  }

  it("rolls the reply back before the newer turn's write and request", async () => {
    const { brain, client } = await speakingA();

    brain.submit({ kind: "user", text: "B" });

    expect(transcript(brain.getHistory())).toEqual([
      "user:one",
      "character:reply-one",
      "user:A",
      "user:B",
    ]);
    expect(promptContents(client.promptFor("B"))).toEqual([
      "one",
      "reply-one",
      "A",
      "B",
    ]);
  });

  it("rolls it back first when the newer turn is itself superseded in the same tick", async () => {
    const harness = await speakingA();
    const { charivo, brain, client, manager } = harness;
    const afterWrite = new Map<string, string[]>();
    const addToHistory = manager.addToHistory.bind(manager);
    vi.spyOn(manager, "addToHistory").mockImplementation((message, options) => {
      const rollback = addToHistory(message, options);
      afterWrite.set(message.content, transcript(manager.getHistory()));
      return rollback;
    });
    let turnC: BrainTurn | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content === "B") {
        turnC ??= brain.submit({ kind: "user", text: "C" });
      }
    });

    const turnB = brain.submit({ kind: "user", text: "B" });

    expect(turnC).toBeDefined();
    await expect(turnB.done).resolves.toMatchObject({ status: "cancelled" });
    expect(afterWrite.get("B")).toEqual([
      "user:one",
      "character:reply-one",
      "user:A",
      "user:B",
    ]);
    expect(client.calledFor("B")).toBe(false);
    expect(promptContents(client.promptFor("C"))).toEqual(["A", "B", "C"]);
  });
});

/** Content as the model got it, without the direction prefix or event wrapper. */
function bare(content: string): string {
  return content
    .replace(/^\[Stage direction[^\]]*\] /, "")
    .replace(/^<event source="[^"]*">([\s\S]*)<\/event>$/, "$1");
}

/** The request whose newest message is `text`, after the system prompt and unwrapped. */
function requestFor(client: GateableLLMClient, text: string): string[] {
  const prompt = client.prompts.find(
    (candidate) => bare(lastContentOf(candidate)) === text,
  );
  if (!prompt) {
    throw new Error(`No LLM request was made for "${text}"`);
  }
  return prompt.slice(1).map((message) => bare(message.content));
}

/** No renderer, and replies named after the unwrapped input. */
function policyHarness(options: HarnessOptions = {}): Harness {
  const harness = createHarness({ renderer: false, ...options });
  harness.client.responder = (content) => `reply-${bare(content)}`;
  return harness;
}

/** Parks the request for user input "A" until the test settles it. */
function parkA(harness: Harness): BrainTurn {
  harness.client.responder = (content) =>
    content === "A" ? null : `reply-${bare(content)}`;
  return harness.brain.submit({ kind: "user", text: "A" });
}

describe("cascade brain: respond", () => {
  it("makes no request for a silent input and leaves the live turn running", async () => {
    const harness = policyHarness();
    const { brain, client, recorder } = harness;
    const turnA = parkA(harness);
    await client.waitForCalls(1);

    const silent = brain.submit({ kind: "user", text: "S", respond: "silent" });

    await expect(silent.done).resolves.toEqual({ status: "silent" });
    expect(client.prompts).toHaveLength(1);
    client.resolveCall("A", "reply-A");
    await expect(turnA.done).resolves.toMatchObject({
      status: "completed",
      text: "reply-A",
    });
    expect(client.prompts).toHaveLength(1);
    expect(recorder.cancelled).toEqual([]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:S",
      "character:reply-A",
    ]);
  });

  it("responds to an auto event on an idle brain and floor", async () => {
    const { brain, client } = policyHarness();

    await expect(
      brain.submit({ kind: "event", source: "game", text: "goal" }).done,
    ).resolves.toMatchObject({ status: "completed", text: "reply-goal" });
    expect(requestFor(client, "goal")).toEqual(["goal"]);
    expect(transcript(brain.getHistory())).toEqual([
      "event:goal",
      "character:reply-goal",
    ]);
  });

  it("keeps an auto event silent while a turn is live", async () => {
    const harness = policyHarness();
    const { brain, client, recorder } = harness;
    const turnA = parkA(harness);
    await client.waitForCalls(1);

    const event = brain.submit({ kind: "event", source: "game", text: "goal" });

    await expect(event.done).resolves.toEqual({ status: "silent" });
    client.resolveCall("A", "reply-A");
    await expect(turnA.done).resolves.toMatchObject({ status: "completed" });
    expect(client.prompts).toHaveLength(1);
    expect(recorder.cancelled).toEqual([]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "event:goal",
      "character:reply-A",
    ]);
  });

  it("keeps an auto event silent while an app perform() holds the floor", async () => {
    const { charivo, brain, client, tts } = policyHarness({ tts: true });
    tts.holdSpeak = (text) => text === "app line";
    const line = charivo.perform({ text: "app line" });
    await tts.waitForSpeaks(1);

    const event = brain.submit({ kind: "event", source: "game", text: "goal" });

    await expect(event.done).resolves.toEqual({ status: "silent" });
    expect(charivo.getFloor()).toMatchObject({
      state: "speaking",
      origin: "app",
    });
    tts.settleSpeak((text) => text === "app line");
    await expect(line.done).resolves.toMatchObject({ status: "completed" });
    expect(client.prompts).toEqual([]);
    expect(transcript(brain.getHistory())).toEqual(["event:goal"]);
  });

  it("keeps an auto event silent while realtime is attached", async () => {
    const { charivo, brain, client } = policyHarness();
    charivo.attachRealtime(new StubRealtimeManager());

    await expect(
      brain.submit({ kind: "event", source: "game", text: "goal" }).done,
    ).resolves.toEqual({ status: "silent" });
    expect(client.prompts).toEqual([]);
    expect(transcript(brain.getHistory())).toEqual(["event:goal"]);
  });

  it("responds to an auto event submitted as the previous reply's performance ends", async () => {
    const { charivo, brain, client } = policyHarness();
    let event: BrainTurn | undefined;
    charivo.on("performance:end", () => {
      event ??= brain.submit({ kind: "event", source: "game", text: "goal" });
    });

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toMatchObject({ status: "completed" });
    await expect(event!.done).resolves.toMatchObject({
      status: "completed",
      text: "reply-goal",
    });
    expect(requestFor(client, "goal")).toEqual(["A", "reply-A", "goal"]);
  });

  it("supersedes the live turn with a must event", async () => {
    const harness = policyHarness();
    const { brain, client, recorder } = harness;
    const turnA = parkA(harness);
    await client.waitForCalls(1);

    const event = brain.submit({
      kind: "event",
      source: "game",
      text: "goal",
      respond: "must",
    });

    await expect(event.done).resolves.toMatchObject({
      status: "completed",
      text: "reply-goal",
    });
    client.resolveCall("A", "reply-A");
    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    expect(recorder.cancelled).toEqual(["A"]);
    expect(requestFor(client, "goal")).toEqual(["A", "goal"]);
  });
});

describe("cascade brain: history", () => {
  it.each([
    { label: "keep", history: "keep" as const },
    { label: "replaceKey", history: { replaceKey: "score" } },
  ])(
    "stores a silent $label input and generates nothing",
    async ({ history }) => {
      const { brain, client, recorder } = policyHarness();

      await expect(
        brain.submit({
          kind: "event",
          source: "game",
          text: "goal",
          respond: "silent",
          history,
        }).done,
      ).resolves.toEqual({ status: "silent" });
      expect(client.prompts).toEqual([]);
      expect(recorder.log).toEqual(["sent:goal"]);
      expect(transcript(brain.getHistory())).toEqual(["event:goal"]);
    },
  );

  it("leaves history untouched for a silent ephemeral input", async () => {
    const { brain, client } = policyHarness();
    await brain.submit({ kind: "user", text: "hi" }).done;

    await expect(
      brain.submit({
        kind: "direction",
        text: "smile",
        respond: "silent",
      }).done,
    ).resolves.toEqual({ status: "silent" });
    expect(client.prompts).toHaveLength(1);
    expect(transcript(brain.getHistory())).toEqual([
      "user:hi",
      "character:reply-hi",
    ]);
  });

  it("leaves history untouched for an auto ephemeral event that falls back to silent", async () => {
    const harness = policyHarness();
    const { brain, client } = harness;
    const turnA = parkA(harness);
    await client.waitForCalls(1);

    await expect(
      brain.submit({
        kind: "event",
        source: "game",
        text: "goal",
        history: "ephemeral",
      }).done,
    ).resolves.toEqual({ status: "silent" });
    client.resolveCall("A", "reply-A");
    await turnA.done;
    expect(client.prompts).toHaveLength(1);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);
  });

  it("sends an ephemeral direction with the request and keeps only its reply", async () => {
    const { brain, client } = policyHarness();
    await brain.submit({ kind: "user", text: "hi" }).done;

    await expect(
      brain.submit({ kind: "direction", text: "wave" }).done,
    ).resolves.toMatchObject({ status: "completed", text: "reply-wave" });
    expect(requestFor(client, "wave")).toEqual(["hi", "reply-hi", "wave"]);
    expect(client.prompts[1]!.at(-1)).toMatchObject({
      role: "system",
      content: expect.stringMatching(/^\[Stage direction.* wave$/),
    });
    expect(transcript(brain.getHistory())).toEqual([
      "user:hi",
      "character:reply-hi",
      "character:reply-wave",
    ]);
  });

  it.each([
    {
      label: "an ephemeral",
      history: "ephemeral" as const,
      kept: "beach",
    },
    {
      label: "a replaceKey",
      history: { replaceKey: "scene" },
      kept: "park",
    },
  ])(
    "writes $label input superseded before its write by its own policy",
    async ({ history, kept }) => {
      const { charivo, brain, client, recorder } = policyHarness();
      await brain.submit({
        kind: "direction",
        text: "beach",
        respond: "silent",
        history: { replaceKey: "scene" },
      }).done;
      let turnB: BrainTurn | undefined;
      charivo.on("message:sent", ({ message }) => {
        if (message.content === "park") {
          turnB ??= brain.submit({ kind: "user", text: "B" });
        }
      });

      const turnD = brain.submit({ kind: "direction", text: "park", history });

      await expect(turnD.done).resolves.toMatchObject({ status: "cancelled" });
      await expect(turnB!.done).resolves.toMatchObject({
        status: "completed",
      });
      expect(recorder.cancelled).toEqual(["park"]);
      expect(client.prompts).toHaveLength(1);
      expect(requestFor(client, "B")).toEqual([kept, "B"]);
      expect(transcript(brain.getHistory())).toEqual([
        `direction:${kept}`,
        "user:B",
        "character:reply-B",
      ]);
    },
  );

  it("keeps one entry per replaceKey across two events", async () => {
    const { brain, client } = policyHarness();
    const score = { replaceKey: "score" };

    await brain.submit({
      kind: "event",
      source: "game",
      text: "1-0",
      history: score,
    }).done;
    await brain.submit({
      kind: "event",
      source: "game",
      text: "2-0",
      history: score,
    }).done;

    expect(requestFor(client, "2-0")).toEqual(["reply-1-0", "2-0"]);
    expect(transcript(brain.getHistory())).toEqual([
      "character:reply-1-0",
      "event:2-0",
      "character:reply-2-0",
    ]);
  });

  it.each([{ respond: "auto" as const }, { respond: "silent" as const }])(
    "fails an $respond event with no source at generate with no request",
    async ({ respond }) => {
      const { brain, client, recorder } = policyHarness();

      const result = await brain.submit({
        kind: "event",
        text: "goal",
        respond,
      } as unknown as BrainInput).done;

      expect(result).toMatchObject({
        status: "failed",
        stage: "generate",
        text: "",
      });
      expect(result.status === "failed" && result.error).toBeInstanceOf(
        CharivoStateError,
      );
      expect(client.prompts).toEqual([]);
      expect(recorder.log).toEqual(["sent:goal"]);
      expect(brain.getHistory()).toEqual([]);
    },
  );

  it("keeps the newest replies to a run of ephemeral directions up to the bound", async () => {
    const { brain, client } = policyHarness({ maxHistoryTurns: 2 });

    for (const text of ["d1", "d2", "d3", "d4", "d5"]) {
      await expect(
        brain.submit({ kind: "direction", text }).done,
      ).resolves.toMatchObject({ status: "completed" });
    }
    expect(transcript(brain.getHistory())).toEqual([
      "character:reply-d2",
      "character:reply-d3",
      "character:reply-d4",
      "character:reply-d5",
    ]);

    await brain.submit({ kind: "direction", text: "d6" }).done;
    expect(requestFor(client, "d6")).toEqual([
      "reply-d2",
      "reply-d3",
      "reply-d4",
      "reply-d5",
      "d6",
    ]);
  });

  it.each([
    {
      label: "keep",
      history: "keep" as const,
      stored: ["user:A", "user:S", "character:reply-A"],
    },
    {
      label: "a shared replaceKey",
      history: { replaceKey: "k" },
      stored: ["user:S", "character:reply-A"],
    },
    {
      label: "ephemeral",
      history: "ephemeral" as const,
      stored: ["user:S", "character:reply-A"],
    },
  ])(
    "keeps a silent input from A's message:sent out of A's request, with $label",
    async ({ history, stored }) => {
      const { charivo, brain, client } = policyHarness();
      let silent: BrainTurn | undefined;
      charivo.on("message:sent", ({ message }) => {
        if (message.content === "A") {
          silent ??= brain.submit({
            kind: "user",
            text: "S",
            respond: "silent",
            history: history === "ephemeral" ? "keep" : history,
          });
        }
      });

      await expect(
        brain.submit({ kind: "user", text: "A", history }).done,
      ).resolves.toMatchObject({ status: "completed", text: "reply-A" });
      await expect(silent!.done).resolves.toEqual({ status: "silent" });
      expect(client.prompts).toHaveLength(1);
      expect(requestFor(client, "A")).toEqual(["A"]);
      expect(transcript(brain.getHistory())).toEqual(stored);
    },
  );

  it("writes a silent input queued behind a turn whose own write is refused", async () => {
    const { charivo, brain, client, manager } = policyHarness();
    const addToHistory = manager.addToHistory.bind(manager);
    vi.spyOn(manager, "addToHistory").mockImplementation((message, options) => {
      if (message.content === "A") {
        throw new CharivoStateError("refused");
      }
      return addToHistory(message, options);
    });
    let silent: BrainTurn | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content === "A") {
        silent ??= brain.submit({ kind: "user", text: "S", respond: "silent" });
      }
    });

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toMatchObject({ status: "failed" });
    await expect(silent!.done).resolves.toEqual({ status: "silent" });
    expect(client.prompts).toEqual([]);
    expect(transcript(brain.getHistory())).toEqual(["user:S"]);
  });
});

describe("cascade brain: review", () => {
  /** Records what review was handed and returns `answer` for it. */
  function reviewing(
    answer: (
      input: CascadeReviewInput,
    ) => ReturnType<NonNullable<HarnessOptions["review"]>> = ({ reply }) =>
      reply,
  ) {
    const seen: Array<{ reply: CascadeReply; directions: string[] }> = [];
    const review = vi.fn((input: CascadeReviewInput) => {
      seen.push({
        reply: input.reply,
        directions: transcript(input.directions),
      });
      return answer(input);
    });
    return { review, seen };
  }

  it("hands review the reply and the request's directions, and no user or event entry", async () => {
    const { review, seen } = reviewing();
    const { brain } = policyHarness({ review });
    await brain.submit({ kind: "user", text: "hi" }).done;
    await brain.submit({
      kind: "direction",
      text: "calm",
      respond: "silent",
      history: "keep",
    }).done;
    await brain.submit({
      kind: "event",
      source: "game",
      text: "goal",
      respond: "silent",
    }).done;

    await expect(
      brain.submit({ kind: "direction", text: "wave" }).done,
    ).resolves.toMatchObject({ status: "completed", text: "reply-wave" });

    expect(seen.at(-1)).toEqual({
      reply: { text: "reply-wave" },
      directions: ["direction:calm", "direction:wave"],
    });
  });

  it("lists a kept direction that is the turn's own input once", async () => {
    const { review, seen } = reviewing();
    const { brain } = policyHarness({ review });

    await brain.submit({ kind: "direction", text: "wave", history: "keep" })
      .done;

    expect(seen).toEqual([
      { reply: { text: "reply-wave" }, directions: ["direction:wave"] },
    ]);
  });

  it("leaves out a silent direction stored while the request is in flight", async () => {
    const { review, seen } = reviewing();
    const harness = policyHarness({ review });
    const { brain, client } = harness;
    const turnA = parkA(harness);
    await client.waitForCalls(1);

    await brain.submit({
      kind: "direction",
      text: "later",
      respond: "silent",
      history: "keep",
    }).done;
    client.resolveCall("A", "reply-A");

    await expect(turnA.done).resolves.toMatchObject({ status: "completed" });
    expect(seen).toEqual([{ reply: { text: "reply-A" }, directions: [] }]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "direction:later",
      "character:reply-A",
    ]);
  });

  it("performs and commits the reply review returns", async () => {
    const { review } = reviewing(() => ({
      text: "edited",
      affect: { expression: "smile" },
    }));
    const { charivo, brain, tts, recorder } = createHarness({
      review,
      tts: true,
    });
    const expressions: string[] = [];
    charivo.on("avatar:expression", ({ expressionId, source }) => {
      expressions.push(`${expressionId}:${source}`);
    });
    const starts: Array<boolean | undefined> = [];
    charivo.on("performance:start", ({ affectResolved }) => {
      starts.push(affectResolved);
    });

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toEqual({
      status: "completed",
      text: "edited",
      heardText: "edited",
    });
    expect(recorder.log).toEqual([
      "sent:A",
      "received:edited",
      "start:cascade:edited",
      "end:cascade:completed",
    ]);
    expect(starts).toEqual([true]);
    expect(expressions).toEqual(["smile:performance"]);
    expect(tts.spokenTexts()).toEqual(["edited"]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "character:edited",
    ]);
  });

  it("settles silent on null with nothing presented and the input kept", async () => {
    const { review } = reviewing(() => null);
    const { brain, render, tts, recorder } = createHarness({
      review,
      tts: true,
    });

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toEqual({ status: "silent" });
    expect(recorder.log).toEqual(["sent:A"]);
    expect(render.rendered()).toEqual([]);
    expect(tts.spokenTexts()).toEqual([]);
    expect(transcript(brain.getHistory())).toEqual(["user:A"]);
  });

  it.each([
    {
      label: "throws",
      review: () => {
        throw new Error("review failed");
      },
    },
    {
      label: "rejects",
      review: async () => {
        throw new Error("review failed");
      },
    },
    {
      label: "returns undefined",
      // A JS caller is not held to the declared type.
      review: () => undefined as unknown as CascadeReply,
    },
    {
      label: "returns a reply without string text",
      review: () => ({ text: 42 }) as unknown as CascadeReply,
    },
  ])(
    "fails at generate with the input rolled back when review $label",
    async ({ review }) => {
      const { brain, recorder } = createHarness({ review });

      const result = await brain.submit({ kind: "user", text: "A" }).done;

      // The draft review never approved is not handed back.
      expect(result).toMatchObject({
        status: "failed",
        stage: "generate",
        text: "",
      });
      expect(result.status === "failed" && result.error).toBeInstanceOf(
        CharivoProviderError,
      );
      expect(recorder.log).toEqual(["sent:A"]);
      expect(brain.getHistory()).toEqual([]);
    },
  );

  it("awaits an async review before presenting", async () => {
    const reached = createDeferred();
    const answer = createDeferred<CascadeReply | null>();
    const { review } = reviewing(() => {
      reached.resolve();
      return answer.promise;
    });
    const { brain, recorder } = createHarness({ review });

    const turn = brain.submit({ kind: "user", text: "A" });
    await reached.promise;
    await Promise.resolve();

    expect(recorder.log).toEqual(["sent:A"]);
    answer.resolve({ text: "later" });

    await expect(turn.done).resolves.toMatchObject({
      status: "completed",
      text: "later",
    });
    expect(recorder.log).toEqual([
      "sent:A",
      "received:later",
      "start:cascade:later",
      "end:cascade:completed",
    ]);
  });

  it("presents nothing, and hands back no draft, for a turn superseded during review", async () => {
    const reachedA = createDeferred();
    const answerA = createDeferred<CascadeReply | null>();
    const { review } = reviewing(({ reply }) => {
      if (reply.text !== "reply-A") {
        return reply;
      }
      reachedA.resolve();
      return answerA.promise;
    });
    const { brain, render, recorder } = createHarness({ review });

    const turnA = brain.submit({ kind: "user", text: "A" });
    await reachedA.promise;
    const turnB = brain.submit({ kind: "user", text: "B" });
    answerA.resolve({ text: "edited-A" });

    await expect(turnA.done).resolves.toEqual({
      status: "cancelled",
      text: "",
    });
    await expect(turnB.done).resolves.toMatchObject({ status: "completed" });
    expect(recorder.log).toEqual([
      "sent:A",
      "sent:B",
      "cancelled:A",
      "received:reply-B",
      "start:cascade:reply-B",
      "end:cascade:completed",
    ]);
    expect(render.rendered()).toEqual(["character:reply-B"]);
    expect(transcript(brain.getHistory())).toEqual([
      "user:A",
      "user:B",
      "character:reply-B",
    ]);
  });
});

/**
 * Answers each request with the avatar tool calls `toolCalls` picks for its
 * input, then with `after-tool` once the tool results are in. A follow-up
 * parks on `followUp` when the test sets it.
 */
class AvatarToolClient implements LLMClient {
  toolCalls: (
    content: string,
  ) => Array<{ name: string; arguments: Record<string, unknown> }> = () => [];
  followUp?: Promise<void>;
  readonly followUpReached = createDeferred();
  private seq = 0;

  call = vi.fn(async (_messages: LLMMessage[]) => "unused");
  callWithTools = vi.fn(
    async (messages: LLMMessage[]): Promise<LLMToolResponse> => {
      const content = lastContentOf(messages);
      if (messages[messages.length - 1]?.role === "tool") {
        this.followUpReached.resolve();
        await this.followUp;
        return { content: "after-tool" };
      }
      const calls = this.toolCalls(content);
      if (calls.length === 0) {
        return { content: `reply-${content}` };
      }
      return {
        content: "",
        toolCalls: calls.map((call) => {
          this.seq += 1;
          return { id: `call-${this.seq}`, ...call };
        }),
      };
    },
  );
}

describe("cascade brain: tool-chosen expressions", () => {
  function avatarHarness(options: HarnessOptions = {}) {
    const client = new AvatarToolClient();
    const harness = createHarness({
      renderer: false,
      ...options,
      manager: createLLMManager(client, {
        tools: createAvatarControlTools({
          expressions: ["smile", "sad"],
          motions: { Idle: 2 },
        }),
        resultProjectors: [createAvatarResultProjector()],
      }),
    });
    const log: string[] = [];
    const { charivo } = harness;
    charivo.on("avatar:expression", ({ expressionId, source }) => {
      log.push(`expression:${expressionId}:${source}`);
    });
    charivo.on("avatar:gaze", ({ x, y, source }) => {
      log.push(`gaze:${x},${y}:${source}`);
    });
    charivo.on("avatar:motion", ({ group, index, muteSound }) => {
      log.push(`motion:${group}:${index}:${muteSound ? "muted" : "audible"}`);
    });
    charivo.on("message:received", ({ message }) => {
      log.push(`received:${message.content}`);
    });
    charivo.on("performance:start", ({ affectResolved }) => {
      log.push(`start:${String(affectResolved)}`);
    });
    return { ...harness, avatarClient: client, log };
  }

  const smile = { name: "setExpression", arguments: { expressionId: "smile" } };

  it("shows a setExpression choice with the reply's performance, not during generation", async () => {
    const { brain, avatarClient, log } = avatarHarness();
    avatarClient.toolCalls = (content) => (content === "A" ? [smile] : []);

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toMatchObject({ status: "completed", text: "after-tool" });
    expect(log).toEqual([
      "received:after-tool",
      "start:true",
      "expression:smile:performance",
    ]);
  });

  it("shows the last of two setExpression calls in one request", async () => {
    const { brain, avatarClient, log } = avatarHarness();
    avatarClient.toolCalls = () => [
      smile,
      { name: "setExpression", arguments: { expressionId: "sad" } },
    ];

    await brain.submit({ kind: "user", text: "A" }).done;

    expect(log).toEqual([
      "received:after-tool",
      "start:true",
      "expression:sad:performance",
    ]);
  });

  it("keeps the tool's expression when review returns a reply without affect", async () => {
    const { brain, avatarClient, log } = avatarHarness({
      review: () => ({ text: "edited" }),
    });
    avatarClient.toolCalls = () => [smile];

    await brain.submit({ kind: "user", text: "A" }).done;

    expect(log).toEqual([
      "received:edited",
      "start:true",
      "expression:smile:performance",
    ]);
  });

  it("lets lookAt and a muted playMotion through during generation", async () => {
    const { brain, avatarClient, log } = avatarHarness();
    avatarClient.toolCalls = () => [
      { name: "lookAt", arguments: { x: 0.5, y: 0 } },
      { name: "playMotion", arguments: { group: "Idle", index: 1 } },
    ];

    await brain.submit({ kind: "user", text: "A" }).done;

    expect(log).toEqual([
      "gaze:0.5,0:tool",
      "motion:Idle:1:muted",
      "received:after-tool",
      "start:false",
    ]);
  });

  it("shows no expression for a reply review withholds", async () => {
    const { brain, avatarClient, log } = avatarHarness({ review: () => null });
    avatarClient.toolCalls = () => [smile];

    await expect(
      brain.submit({ kind: "user", text: "A" }).done,
    ).resolves.toEqual({ status: "silent" });
    expect(log).toEqual([]);
  });

  it("shows no expression for a superseded turn", async () => {
    const { brain, avatarClient, log } = avatarHarness();
    avatarClient.toolCalls = (content) => (content === "A" ? [smile] : []);
    const followUp = createDeferred();
    avatarClient.followUp = followUp.promise;

    const turnA = brain.submit({ kind: "user", text: "A" });
    await avatarClient.followUpReached.promise;
    const turnB = brain.submit({ kind: "user", text: "B" });
    followUp.resolve();

    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnB.done).resolves.toMatchObject({ status: "completed" });
    expect(log).toEqual(["received:reply-B", "start:false"]);
  });

  it("lets affect returned by review win over the tool's", async () => {
    const seen: CascadeReply[] = [];
    const { brain, avatarClient, log } = avatarHarness({
      review: ({ reply }) => {
        seen.push(reply);
        return { ...reply, affect: { expression: "sad" } };
      },
    });
    avatarClient.toolCalls = () => [smile];

    await brain.submit({ kind: "user", text: "A" }).done;

    expect(seen).toEqual([
      { text: "after-tool", affect: { expression: "smile" } },
    ]);
    expect(log).toEqual([
      "received:after-tool",
      "start:true",
      "expression:sad:performance",
    ]);
  });
});

describe("cascade brain: retired while its performance starts", () => {
  it("speaks nothing and keeps the reply out of history when a performance:start listener interrupts", async () => {
    const { charivo, brain, tts } = createHarness({ tts: true });
    charivo.on("performance:start", () => {
      void brain.interrupt();
    });

    const result = await brain.submit({ kind: "user", text: "A" }).done;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.status).toBe("cancelled");
    expect(tts.speak).not.toHaveBeenCalled();
    expect(transcript(brain.getHistory())).toEqual(["user:A"]);
  });
});

describe("cascade brain: retired from performance:start with affect", () => {
  it("plays no expression or motion for a turn its start listener interrupts", async () => {
    const { charivo, brain } = createHarness({
      tts: true,
      review: () => ({
        text: "edited",
        affect: { expression: "smile", motion: { group: "Happy", index: 1 } },
      }),
    });
    const avatar: string[] = [];
    charivo.on("avatar:expression", () => avatar.push("expression"));
    charivo.on("avatar:motion", () => avatar.push("motion"));
    charivo.on("performance:start", () => {
      void brain.interrupt();
    });

    await brain.submit({ kind: "user", text: "A" }).done;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(avatar).toEqual([]);
  });
});

describe("cascade brain: one owning body", () => {
  it("refuses a second body until the first detaches, leaving the second without a brain", () => {
    const { charivo: first, brain } = createHarness();
    const second = createCharivo({ character });

    expect(() => second.attachBrain(brain)).toThrow(CharivoStateError);
    expect(second.getBrain()).toBeUndefined();

    first.detachBrain();
    second.attachBrain(brain);
    expect(second.getBrain()).toBe(brain);
  });

  it("leaves the receiving body's own brain and turn alone when the refusal comes", () => {
    const { brain } = createHarness();
    const other = createHarness();

    expect(() => other.charivo.attachBrain(brain)).toThrow(CharivoStateError);

    expect(other.charivo.getBrain()).toBe(other.brain);
  });
});
