import { describe, expect, it, vi } from "vitest";
import {
  CharivoProviderError,
  CharivoStateError,
  createCharivo,
} from "@charivo/core";
import type {
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
import { createCascadeBrain, createLLMManager } from "@charivo/llm";
import {
  GateableLLMClient,
  RecordingLLMManager,
  SignalRecordingLLMManager,
  buildMessage,
  character,
  createDeferred,
  createHarness,
  transcript,
  type Harness,
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

  it("makes a nested turn wait for older queued entries before appending its own", async () => {
    const manager = new RecordingLLMManager();
    const { charivo, brain, recorder } = createHarness({
      manager,
      renderer: false,
    });
    const turns: Record<string, BrainTurn> = {};
    const submitOnce = (text: string) => {
      turns[text] ??= brain.submit({ kind: "user", text });
    };
    // A is superseded by B and B by C inside their announcements, so A, B
    // and C are all queued when C's flush writes A; D enters from that write.
    charivo.on("message:sent", ({ message }) => {
      if (message.content === "A") submitOnce("B");
      if (message.content === "B") submitOnce("C");
    });
    manager.onAdd = (message) => {
      if (message.content === "A") submitOnce("D");
    };
    const addedWhenGenerating = new Map<string, string[]>();
    manager.onGenerate = (message) => {
      addedWhenGenerating.set(message.content, manager.addedContents());
    };

    submitOnce("A");

    await expect(turns.D!.done).resolves.toMatchObject({
      status: "completed",
      text: "reply-D",
    });
    for (const text of ["A", "B", "C"]) {
      await expect(turns[text]!.done).resolves.toMatchObject({
        status: "cancelled",
      });
    }
    expect(manager.addedContents()).toEqual(["A", "B", "C", "D", "reply-D"]);
    expect([...addedWhenGenerating.keys()]).toEqual(["D"]);
    expect(addedWhenGenerating.get("D")).toEqual(["A", "B", "C", "D"]);
    expect(recorder.cancelled).toEqual(["C", "B", "A"]);
  });

  it("keeps the newest turn when the manager reenters submit() from the input's write", async () => {
    const manager = new RecordingLLMManager();
    const { brain, tts, recorder } = createHarness({
      manager,
      renderer: false,
      tts: true,
    });
    let turnC: BrainTurn | undefined;
    manager.onAdd = (message) => {
      if (message.content === "A" && !turnC) {
        turnC = brain.submit({ kind: "user", text: "C" });
      }
    };

    const turnA = brain.submit({ kind: "user", text: "A" });

    await expect(turnC!.done).resolves.toMatchObject({ status: "completed" });
    await expect(turnA.done).resolves.toMatchObject({ status: "cancelled" });
    expect(manager.generatedContents()).toEqual(["C"]);
    expect(manager.addedContents()).toEqual(["A", "C", "reply-C"]);
    expect(tts.spokenTexts()).toEqual(["reply-C"]);
    expect(recorder.cancelled).toEqual(["A"]);
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

  /** Calls `supersede` right after the manager stores `content`. */
  function supersedeAfterWriting(
    harness: Harness,
    content: string,
    supersede: () => void,
  ): void {
    const addToHistory = harness.manager.addToHistory.bind(harness.manager);
    vi.spyOn(harness.manager, "addToHistory").mockImplementation(
      (message, options) => {
        const rollback = addToHistory(message, options);
        if (message.content === content) {
          supersede();
        }
        return rollback;
      },
    );
  }

  const phases: Phase[] = [
    {
      name: "the input's history write",
      arm: (harness, supersede) =>
        supersedeAfterWriting(harness, "A", supersede),
      generates: false,
      received: false,
      started: false,
      spoke: false,
    },
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
      name: "the reply commit",
      arm: (harness, supersede) =>
        supersedeAfterWriting(harness, "reply-A", supersede),
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

describe("cascade brain: a turn superseded from its own reply commit", () => {
  function reenterOnCommit(throwAfter: boolean) {
    const manager = new RecordingLLMManager();
    const harness = createHarness({ manager, renderer: false, tts: true });
    let turnC: BrainTurn | undefined;
    manager.onAdd = (message) => {
      if (message.type !== "character" || turnC) return;
      turnC = harness.brain.submit({ kind: "user", text: "C" });
      if (throwAfter) {
        throw new Error("commit boom");
      }
    };
    return { harness, turnC: () => turnC };
  }

  it("never speaks the retired reply", async () => {
    const { harness, turnC } = reenterOnCommit(false);

    const turnB = harness.brain.submit({ kind: "user", text: "B" });

    await expect(turnB.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnC()!.done).resolves.toMatchObject({
      status: "completed",
    });
    expect(harness.tts.spokenTexts()).toEqual(["reply-C"]);
    expect(harness.recorder.cancelled).toEqual(["B"]);
  });

  it("leaves it cancelled and unspoken when the commit also throws", async () => {
    const { harness, turnC } = reenterOnCommit(true);

    const turnB = harness.brain.submit({ kind: "user", text: "B" });

    await expect(turnB.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(turnC()!.done).resolves.toMatchObject({
      status: "completed",
    });
    expect(harness.tts.spokenTexts()).toEqual(["reply-C"]);
    expect(harness.recorder.cancelled).toEqual(["B"]);
  });
});
