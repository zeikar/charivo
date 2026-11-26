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
} from "@charivo/core";
import { createCascadeBrain, createLLMManager } from "@charivo/llm";
import {
  RecordingLLMManager,
  SignalRecordingLLMManager,
  character,
  createHarness,
  transcript,
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
  it("retires a turn submitted from the retired performance's end", async () => {
    const manager = new SignalRecordingLLMManager();
    manager.hold = (content) => content === "B";
    const { charivo, brain, tts } = createHarness({
      manager,
      renderer: false,
      tts: true,
    });
    tts.holdSpeak = (text) => text === "reply-A";

    const chained: BrainTurn[] = [];
    charivo.on("performance:end", () => {
      if (chained.length === 0) {
        chained.push(brain.submit({ kind: "user", text: "B" }));
      }
    });

    const first = brain.submit({ kind: "user", text: "A" });
    await tts.waitForSpeaks(1);
    const latest = brain.submit({ kind: "user", text: "C" });

    expect(chained).toHaveLength(1);
    expect(manager.signalFor("B")?.aborted).toBe(true);
    await expect(chained[0]!.done).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(first.done).resolves.toMatchObject({ status: "cancelled" });
    await expect(latest.done).resolves.toMatchObject({
      status: "completed",
      text: "reply-C",
    });
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
