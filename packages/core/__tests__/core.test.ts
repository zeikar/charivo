import { describe, expect, it, vi } from "vitest";
import {
  Charivo,
  CharivoError,
  CharivoProviderError,
  CharivoStateError,
  CharivoTransportError,
} from "@charivo/core";
import type {
  Character,
  CharivoEventBus,
  CharivoEventEmitter,
  GazeCoordinates,
  GenerateResponseOptions,
  HistoryRollback,
  LLMClient,
  LLMManager,
  LLMManagerWithTools,
  LLMMessage,
  Message,
  RealtimeManager,
  RealtimeState,
  RenderManager,
  STTManager,
  ToolDefinition,
  ToolRegistration,
  TTSManager,
  TTSOptions,
} from "@charivo/core";
import { EventBus } from "../src/bus";
import { createLLMManager } from "@charivo/llm";
import { createRealtimeManager } from "@charivo/realtime";

class StubRenderManager implements RenderManager {
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  render = vi.fn(
    async (_message: Message, _character?: Character) => undefined,
  );
  setCharacter = vi.fn((_character: Character) => undefined);
  setLocalGaze = vi.fn((_coords: GazeCoordinates) => false);
  setEventBus = vi.fn((_eventBus: CharivoEventBus) => undefined);
  disconnect = vi.fn(() => undefined);
}

class StubTTSManager implements TTSManager {
  speak = vi.fn(async (_text: string, _options?: TTSOptions) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((voice: string) => {
    this.voice = voice;
  });
  isSupported = vi.fn(() => true);
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);
  voice: string | undefined;
}

class StubDisposableTTSManager extends StubTTSManager {
  dispose = vi.fn(async () => undefined);
}

class StubSTTManager implements STTManager {
  start = vi.fn(async () => undefined);
  stop = vi.fn(async () => "");
  isRecording = vi.fn(() => false);
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);
}

class StubRealtimeManager implements RealtimeManager {
  setCharacter = vi.fn((_character: Character) => undefined);
  getState = vi.fn(
    (): RealtimeState => ({
      connection: "idle",
      session: {
        status: "idle",
        config: null,
      },
      response: {
        status: "idle",
        text: "",
      },
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
  generateResponse = vi.fn(async (_message: Message) => "");
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);
}

/**
 * TTS manager stub for the audio-session-overlap regression test below.
 * Unlike StubTTSManager (which resolves immediately with no session state),
 * this one tracks a real "active session" like TTSManagerImpl: speak() opens
 * a session and stays pending until something ends it. A naturally-finishing
 * utterance is released via finishUtterance(); a stop() that interrupts a
 * still-open session settles it deterministically itself (mirroring the
 * fixed TTSManagerImpl.stop(), which now does the same for the audio it
 * pauses instead of leaving that speak() call pending forever).
 */
class ControllableTTSManager implements TTSManager {
  private emitter?: CharivoEventEmitter;
  private sessionSeq = 0;
  private activeSession: number | null = null;
  private readonly gates = new Map<number, () => void>();

  speak = vi.fn(async (_text: string, _options?: TTSOptions) => {
    // Mirrors TTSManagerImpl.speak(): stop any existing session first.
    await this.stop();

    const session = ++this.sessionSeq;
    this.activeSession = session;
    this.emitter?.emit("tts:audio:start", {});

    await new Promise<void>((resolve) => this.gates.set(session, resolve));

    // If stop() interrupted this session, it already deleted the gate,
    // ended the session, and emitted tts:audio:end below -- skip redoing
    // that here. Only a naturally-finishing session reaches this.
    if (this.gates.delete(session)) {
      this.activeSession = null;
      this.emitter?.emit("tts:audio:end", {});
    }
  });

  stop = vi.fn(async () => {
    if (this.activeSession === null) return;
    const session = this.activeSession;
    this.activeSession = null;
    this.emitter?.emit("tts:audio:end", {});

    // Settles the interrupted speak() call itself -- a stopped session has
    // no other way to complete, so leaving this unresolved would strand it.
    const resolveGate = this.gates.get(session);
    if (resolveGate) {
      this.gates.delete(session);
      resolveGate();
    }
  });

  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  setEventEmitter = vi.fn((eventEmitter: CharivoEventEmitter) => {
    this.emitter = eventEmitter;
  });

  getActiveSession(): number | null {
    return this.activeSession;
  }

  /** Lets a held-open speak() call finish naturally. */
  finishUtterance(session: number): void {
    this.gates.get(session)?.();
  }
}

describe("EventBus", () => {
  it("registers, emits, and removes listeners", () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.on("message:sent", listener);
    bus.emit("message:sent", {
      message: {
        id: "1",
        content: "hello",
        timestamp: new Date(),
        type: "user",
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    bus.off("message:sent", listener);
    bus.emit("message:sent", {
      message: {
        id: "2",
        content: "world",
        timestamp: new Date(),
        type: "user",
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    bus.clear();
    bus.emit("message:sent", {
      message: {
        id: "3",
        content: "!",
        timestamp: new Date(),
        type: "user",
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing listener from the listeners behind it", () => {
    const bus = new EventBus();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const throwing = vi.fn(() => {
      throw new Error("listener boom");
    });
    const afterThrowing = vi.fn();

    bus.on("message:sent", throwing);
    bus.on("message:sent", afterThrowing);

    expect(() =>
      bus.emit("message:sent", {
        message: {
          id: "1",
          content: "hello",
          timestamp: new Date(),
          type: "user",
        },
      }),
    ).not.toThrow();

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(afterThrowing).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Event listener for "message:sent" threw:',
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});

describe("Charivo", () => {
  const character: Character = {
    id: "char-1",
    name: "Hiyori",
    description: "A cheerful assistant",
    personality: "Always upbeat",
    voice: {
      voiceId: "alloy",
      rate: 1.5,
      pitch: 1.2,
      volume: 0.8,
    },
  };

  class ResolvingClient implements LLMClient {
    constructor(private response: string) {}
    call = vi.fn(
      async (_messages: Array<{ role: string; content: string }>) =>
        this.response,
    );
  }

  it("routes messages through renderer, llm, and tts", async () => {
    const renderManager = new StubRenderManager();
    const ttsManager = new StubTTSManager();
    const client = new ResolvingClient("Nice to meet you!");
    const llmManager = createLLMManager(client);

    const charivo = new Charivo();
    charivo.attachRenderer(renderManager);
    charivo.attachTTS(ttsManager);
    charivo.attachLLM(llmManager);
    charivo.setCharacter(character);

    const sentListener = vi.fn();
    const receivedListener = vi.fn();
    const speakListener = vi.fn();

    charivo.on("message:sent", sentListener);
    charivo.on("message:received", receivedListener);
    charivo.on("character:speak", speakListener);

    await charivo.userSay("Hello there!");

    expect(sentListener).toHaveBeenCalledTimes(1);
    expect(receivedListener).toHaveBeenCalledTimes(1);
    expect(speakListener).toHaveBeenCalledWith({
      character,
      text: "Nice to meet you!",
    });

    expect(renderManager.render).toHaveBeenCalledTimes(2);
    const firstRenderArgs = renderManager.render.mock.calls[0]!;
    expect(firstRenderArgs[0]!.type).toBe("user");
    const secondRenderArgs = renderManager.render.mock.calls[1]!;
    expect(secondRenderArgs[0]!.type).toBe("character");
    expect(secondRenderArgs[1]).toEqual(character);

    expect(ttsManager.speak).toHaveBeenCalledTimes(1);
    const [spokenText, options] = ttsManager.speak.mock.calls[0]! as [
      string,
      TTSOptions,
    ];
    expect(spokenText).toBe("Nice to meet you!");
    expect(options).toMatchObject({
      rate: character.voice?.rate,
      pitch: character.voice?.pitch,
      volume: character.voice?.volume,
      voice: character.voice?.voiceId,
    });

    const history = charivo.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].type).toBe("user");
    expect(history[1].type).toBe("character");
    expect(charivo.getCurrentCharacter()).toEqual(character);

    charivo.clearHistory();
    expect(charivo.getHistory()).toHaveLength(0);
  });

  it("handles flows without LLM, renderer, or tts gracefully", async () => {
    const charivo = new Charivo();
    const messageSpy = vi.fn();

    charivo.on("message:sent", messageSpy);

    await expect(charivo.userSay("Hello")).resolves.toBeUndefined();
    await expect(charivo.userSay("")).resolves.toBeUndefined();

    expect(messageSpy).toHaveBeenCalledTimes(2);
  });

  it("propagates character and event wiring across attached managers", () => {
    const renderManager = new StubRenderManager();
    const ttsManager = new StubTTSManager();
    const sttManager = new StubSTTManager();
    const realtimeManager = new StubRealtimeManager();
    const charivo = new Charivo();
    const customListener = vi.fn();

    charivo.setCharacter(character);
    charivo.attachRenderer(renderManager);
    charivo.attachTTS(ttsManager);
    charivo.attachSTT(sttManager);
    charivo.attachRealtime(realtimeManager);

    expect(renderManager.setCharacter).toHaveBeenCalledWith(character);
    expect(renderManager.setEventBus).toHaveBeenCalledTimes(1);
    expect(ttsManager.setEventEmitter).toHaveBeenCalledTimes(1);
    expect(sttManager.setEventEmitter).toHaveBeenCalledTimes(1);
    expect(realtimeManager.setEventEmitter).toHaveBeenCalledTimes(1);
    expect(realtimeManager.setCharacter).toHaveBeenCalledWith(character);
    expect(charivo.getSTTManager()).toBe(sttManager);
    expect(charivo.getRealtimeManager()).toBe(realtimeManager);
    expect(charivo.isRealtimeModeEnabled()).toBe(true);

    charivo.on("realtime:assistant:delta", customListener);
    charivo.emit("realtime:assistant:delta", { text: "partial" });
    expect(customListener).toHaveBeenCalledWith({ text: "partial" });

    charivo.off("realtime:assistant:delta", customListener);
    charivo.emit("realtime:assistant:delta", { text: "ignored" });
    expect(customListener).toHaveBeenCalledTimes(1);

    charivo.detachTTS();
    charivo.detachSTT();
    charivo.detachLLM();
    charivo.detachRenderer();
    charivo.detachRealtime();

    expect(charivo.getSTTManager()).toBeUndefined();
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.getHistory()).toHaveLength(0);
    expect(charivo.isRealtimeModeEnabled()).toBe(false);
    expect(renderManager.destroy).not.toHaveBeenCalled();
  });

  it("attachLLM connects setEventEmitter when the manager defines it", () => {
    const llmManager = new StubLLMManager();
    const charivo = new Charivo();

    charivo.attachLLM(llmManager);

    expect(llmManager.setEventEmitter).toHaveBeenCalledTimes(1);

    // The emitter must be the live event bus: emitting through it reaches
    // listeners registered via the Charivo facade.
    const emitter = llmManager.setEventEmitter.mock
      .calls[0]?.[0] as CharivoEventEmitter;
    const listener = vi.fn();
    charivo.on("avatar:expression", listener);
    emitter.emit("avatar:expression", { expressionId: "smile" });
    expect(listener).toHaveBeenCalledWith({ expressionId: "smile" });
  });

  it("attachLLM does not throw when the manager has no setEventEmitter", () => {
    const client = new ResolvingClient("hi");
    const llmManager = createLLMManager(client);
    const charivo = new Charivo();

    expect(() => charivo.attachLLM(llmManager)).not.toThrow();
  });

  it("detachRenderer disconnects without destroying the manager", () => {
    const renderManager = new StubRenderManager();
    const charivo = new Charivo();

    charivo.attachRenderer(renderManager);
    charivo.detachRenderer();

    expect(renderManager.disconnect).toHaveBeenCalledTimes(1);
    expect(renderManager.destroy).not.toHaveBeenCalled();
  });

  it("attachRenderer disconnects the previously-attached manager before replacing it", () => {
    const managerA = new StubRenderManager();
    const managerB = new StubRenderManager();
    const charivo = new Charivo();

    charivo.attachRenderer(managerA);
    charivo.attachRenderer(managerB);

    expect(managerA.disconnect).toHaveBeenCalledTimes(1);
    expect(managerB.setEventBus).toHaveBeenCalledTimes(1);
  });

  it("emits tts:error when synthesis fails and skips detached tts", async () => {
    const renderManager = new StubRenderManager();
    const ttsManager = new StubTTSManager();
    const client = new ResolvingClient("Still here.");
    const llmManager = createLLMManager(client);
    const charivo = new Charivo();
    const ttsErrorListener = vi.fn();

    ttsManager.speak.mockRejectedValueOnce(new Error("tts failed"));

    charivo.attachRenderer(renderManager);
    charivo.attachTTS(ttsManager);
    charivo.attachLLM(llmManager);
    charivo.setCharacter(character);
    charivo.on("tts:error", ttsErrorListener);

    await charivo.userSay("Hello");

    expect(ttsErrorListener).toHaveBeenCalledTimes(1);
    expect(ttsErrorListener.mock.calls[0]?.[0]).toMatchObject({
      error: expect.objectContaining({
        message: "tts failed",
      }),
    });

    ttsManager.speak.mockClear();
    charivo.detachTTS();

    await charivo.userSay("Hello again");

    expect(ttsManager.speak).not.toHaveBeenCalled();
  });

  it("stops stale TTS before the next turn can project its expression, so audio:end ordering stays correct across overlapping turns", async () => {
    // Regression for: turn A's utterance is still playing when turn B starts
    // and projects its own expression via a tool call. TTSManagerImpl.speak()
    // stops existing playback before starting the replacement, and that stop
    // emits tts:audio:end. If that stop happened AFTER B's expression was
    // projected (the pre-fix ordering), a consumer that releases the
    // expression on tts:audio:end (RenderManager) would clear B's expression
    // before B's own speech even starts. Charivo.userSay() now stops any
    // active TTS at the START of the turn, before the LLM can project an
    // expression, so A's end is pushed ahead of B's expression instead.
    const ttsManager = new ControllableTTSManager();
    const charivo = new Charivo();
    const events: string[] = [];
    let notifyAt: { length: number; resolve: () => void } | null = null;

    const record = (type: string) => {
      events.push(type);
      if (notifyAt && events.length >= notifyAt.length) {
        notifyAt.resolve();
        notifyAt = null;
      }
    };
    const waitForEvents = (length: number): Promise<void> => {
      if (events.length >= length) return Promise.resolve();
      return new Promise((resolve) => {
        notifyAt = { length, resolve };
      });
    };

    let emitter: CharivoEventEmitter | undefined;
    const llmManager: LLMManager = {
      setCharacter: vi.fn(),
      getCharacter: vi.fn(() => null),
      clearHistory: vi.fn(),
      getHistory: vi.fn(() => []),
      addToHistory: vi.fn(
        (_message: Message): HistoryRollback =>
          () =>
            undefined,
      ),
      setEventEmitter: vi.fn((e: CharivoEventEmitter) => {
        emitter = e;
      }),
      generateResponse: vi.fn(async (message: Message) => {
        if (message.content === "turn B") {
          // Simulates a tool-driven avatar:expression call during turn B's
          // LLM generation, before turn B's own TTS speak() is invoked.
          emitter?.emit("avatar:expression", { expressionId: "smile" });
        }
        return message.content === "turn A" ? "Reply A" : "Reply B";
      }),
    };

    charivo.attachTTS(ttsManager);
    charivo.attachLLM(llmManager);
    charivo.setCharacter(character);

    charivo.on("tts:audio:start", () => record("audio:start"));
    charivo.on("tts:audio:end", () => record("audio:end"));
    charivo.on("avatar:expression", () => record("expression"));

    // Latest-wins additions, kept in their own log so the ordering assertions
    // below stay exactly what they were: turn B supersedes turn A, so A must
    // be announced once -- before B's pre-turn stop ends A's audio -- and A,
    // being stale from then on, must never emit its own tts:end.
    const userMessageIds = new Map<string, string>();
    const lifecycle: string[] = [];
    charivo.on("message:sent", ({ message }) => {
      userMessageIds.set(message.content, message.id);
    });
    charivo.on("turn:cancelled", ({ userMessageId }) => {
      lifecycle.push(`cancelled:${userMessageId}`);
    });
    charivo.on("tts:audio:end", () => lifecycle.push("audio:end"));
    charivo.on("tts:end", () => lifecycle.push("tts:end"));

    // Turn A: fire-and-forget. Its speak() call stays pending (audio still
    // "playing") until finishUtterance() releases it below.
    const turnA = charivo.userSay("turn A");
    await waitForEvents(1);
    const sessionA = ttsManager.getActiveSession();
    expect(sessionA).not.toBeNull();

    // Turn B starts while A's audio is still active.
    const turnB = charivo.userSay("turn B");
    await waitForEvents(4);

    expect(events).toEqual([
      "audio:start",
      "audio:end",
      "expression",
      "audio:start",
    ]);

    const sessionB = ttsManager.getActiveSession();
    expect(sessionB).not.toBeNull();
    expect(sessionB).not.toBe(sessionA);

    // Turn A's own userSay() call must settle on its own once B's pre-turn
    // stop() interrupts it -- no manual finishUtterance() for session A.
    // TTSManagerImpl.stop() now settles the playback it interrupts
    // deterministically instead of leaving that speak() call pending
    // forever (see packages/tts/src/tts-manager.ts), and this stub mirrors
    // that same contract. A bounded race gives a clear failure instead of
    // the whole test hanging if that regresses.
    await Promise.race([
      turnA,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("turn A did not settle on its own")),
          200,
        ),
      ),
    ]);

    ttsManager.finishUtterance(sessionB!);
    await turnB;

    expect(events).toEqual([
      "audio:start", // A
      "audio:end", // A, ended by B's pre-turn stop, BEFORE B's expression
      "expression", // B
      "audio:start", // B
      "audio:end", // B's own natural end
    ]);

    expect(lifecycle).toEqual([
      `cancelled:${userMessageIds.get("turn A")}`, // announced once, for A
      "audio:end", // A's, ended by B's pre-turn stop, after the announcement
      "audio:end", // B's own natural end
      "tts:end", // B's only: stale A emits none
    ]);
  });

  it("wraps llm manager failures in typed provider errors", async () => {
    const failingClient = {
      call: vi.fn(async () => {
        throw new Error("upstream failed");
      }),
    } satisfies LLMClient;
    const llmManager = createLLMManager(failingClient);
    const charivo = new Charivo();

    charivo.attachLLM(llmManager);
    charivo.setCharacter(character);

    const run = charivo.userSay("Hello");

    await expect(run).rejects.toBeInstanceOf(CharivoProviderError);
    await expect(run).rejects.toBeInstanceOf(CharivoError);
  });

  it("surfaces typed realtime transport errors across packages", async () => {
    const realtimeClient = {
      connect: vi.fn(async () => {
        throw new Error("socket closed");
      }),
      updateSession: vi.fn(async () => undefined),
      recover: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      sendText: vi.fn(async () => undefined),
      sendAudio: vi.fn(async () => undefined),
      sendToolResult: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      onEvent: vi.fn((_callback: (event: unknown) => void) => undefined),
    };

    const manager = createRealtimeManager(
      realtimeClient as Parameters<typeof createRealtimeManager>[0],
    );

    const run = manager.startSession();

    await expect(run).rejects.toBeInstanceOf(CharivoTransportError);
    await expect(run).rejects.toBeInstanceOf(CharivoError);
  });

  it("disposes managers in order, clears references, and stays idempotent", async () => {
    const calls: string[] = [];
    const renderManager = new StubRenderManager();
    const ttsManager = new StubTTSManager();
    const sttManager = new StubSTTManager();
    const realtimeManager = new StubRealtimeManager();
    const client = new ResolvingClient("Bye");
    const llmManager = createLLMManager(client);
    const charivo = new Charivo();

    realtimeManager.stopSession.mockImplementation(async () => {
      calls.push("realtime");
    });
    ttsManager.stop.mockImplementation(async () => {
      calls.push("tts");
    });
    sttManager.isRecording.mockReturnValue(true);
    sttManager.stop.mockImplementation(async () => {
      calls.push("stt");
      return "";
    });
    renderManager.destroy.mockImplementation(async () => {
      calls.push("render");
    });

    charivo.attachRenderer(renderManager);
    charivo.attachTTS(ttsManager);
    charivo.attachSTT(sttManager);
    charivo.attachRealtime(realtimeManager);
    charivo.attachLLM(llmManager);
    charivo.setCharacter(character);
    await charivo.userSay("Hello");
    // userSay's own pre-turn stop() records a "tts" entry unrelated to the
    // dispose ordering under test; clear it so `calls` reflects dispose only.
    calls.length = 0;

    await charivo.dispose();
    await charivo.dispose();

    expect(calls).toEqual(["realtime", "tts", "stt", "render"]);
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.getSTTManager()).toBeUndefined();
    expect(charivo.getCurrentCharacter()).toBeNull();
    expect(charivo.isRealtimeModeEnabled()).toBe(false);
  });

  it("continues dispose cleanup and throws only the first typed failure", async () => {
    const renderManager = new StubRenderManager();
    const ttsManager = new StubTTSManager();
    const sttManager = new StubSTTManager();
    const realtimeManager = new StubRealtimeManager();
    const client = new ResolvingClient("Bye");
    const llmManager = createLLMManager(client);
    const charivo = new Charivo();

    realtimeManager.stopSession.mockRejectedValueOnce(
      new Error("realtime failed"),
    );
    ttsManager.stop.mockRejectedValueOnce(new Error("tts failed"));
    sttManager.isRecording.mockReturnValue(true);
    sttManager.stop.mockRejectedValueOnce(new Error("stt failed"));
    renderManager.destroy.mockRejectedValueOnce(new Error("render failed"));

    charivo.attachRenderer(renderManager);
    charivo.attachTTS(ttsManager);
    charivo.attachSTT(sttManager);
    charivo.attachRealtime(realtimeManager);
    charivo.attachLLM(llmManager);

    await expect(charivo.dispose()).rejects.toMatchObject({
      name: "CharivoDisposeError",
      cause: expect.objectContaining({
        message: "realtime failed",
      }),
    });

    expect(ttsManager.stop).toHaveBeenCalledTimes(1);
    expect(sttManager.stop).toHaveBeenCalledTimes(1);
    expect(renderManager.destroy).toHaveBeenCalledTimes(1);
  });

  it("awaits TTS dispose after stopping the manager", async () => {
    const calls: string[] = [];
    let disposeSettled = false;
    const ttsManager = new StubDisposableTTSManager();
    const charivo = new Charivo();

    ttsManager.stop.mockImplementation(async () => {
      calls.push("stop");
    });
    ttsManager.dispose.mockImplementation(async () => {
      calls.push("dispose");
      await Promise.resolve();
      disposeSettled = true;
    });

    charivo.attachTTS(ttsManager);
    await charivo.dispose();

    expect(calls).toEqual(["stop", "dispose"]);
    expect(disposeSettled).toBe(true);
  });

  it("disposes TTS resources even when stop() and dispose() both fail", async () => {
    const ttsManager = new StubDisposableTTSManager();
    const charivo = new Charivo();

    ttsManager.stop.mockRejectedValueOnce(new Error("tts stop failed"));
    ttsManager.dispose.mockRejectedValueOnce(new Error("tts dispose failed"));

    charivo.attachTTS(ttsManager);

    await expect(charivo.dispose()).rejects.toMatchObject({
      name: "CharivoDisposeError",
      cause: expect.objectContaining({
        message: "tts stop failed",
      }),
    });

    expect(ttsManager.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects with the dispose failure when stop() succeeds but dispose() fails", async () => {
    const ttsManager = new StubDisposableTTSManager();
    const charivo = new Charivo();

    ttsManager.dispose.mockRejectedValueOnce(new Error("tts dispose failed"));

    charivo.attachTTS(ttsManager);

    await expect(charivo.dispose()).rejects.toMatchObject({
      name: "CharivoDisposeError",
      cause: expect.objectContaining({
        message: "tts dispose failed",
      }),
    });

    expect(ttsManager.stop).toHaveBeenCalledTimes(1);
    expect(ttsManager.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes cleanly when the TTS manager has no dispose method", async () => {
    const ttsManager = new StubTTSManager();
    const charivo = new Charivo();

    charivo.attachTTS(ttsManager);

    await expect(charivo.dispose()).resolves.toBeUndefined();
    expect(ttsManager.stop).toHaveBeenCalledTimes(1);
  });

  it("dispose() calls destroy on the render manager but does not call disconnect a second time after destroy", async () => {
    const renderManager = new StubRenderManager();
    const charivo = new Charivo();

    charivo.attachRenderer(renderManager);
    await charivo.dispose();

    // destroy handles disconnect internally; dispose must not issue a second disconnect
    expect(renderManager.destroy).toHaveBeenCalledTimes(1);
    expect(renderManager.disconnect).toHaveBeenCalledTimes(0);
  });

  it("continues best-effort dispose when stt recording probe throws", async () => {
    const calls: string[] = [];
    const renderManager = new StubRenderManager();
    const ttsManager = new StubTTSManager();
    const sttManager = new StubSTTManager();
    const charivo = new Charivo();

    ttsManager.stop.mockImplementation(async () => {
      calls.push("tts");
    });
    sttManager.isRecording.mockImplementation(() => {
      throw new Error("recording state unavailable");
    });
    renderManager.destroy.mockImplementation(async () => {
      calls.push("render");
    });

    charivo.attachRenderer(renderManager);
    charivo.attachTTS(ttsManager);
    charivo.attachSTT(sttManager);

    await expect(charivo.dispose()).rejects.toMatchObject({
      name: "CharivoDisposeError",
      cause: expect.objectContaining({
        message: "recording state unavailable",
      }),
    });

    expect(calls).toEqual(["tts", "render"]);
    expect(charivo.getSTTManager()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Latest-wins userSay: gates for every phase of a turn.
//
// Everything below is settled by hand -- no timers, no elapsed-time
// assumptions. A stub parks the turn wherever the test needs it and the test
// releases it explicitly, so the interleavings under test are exact.
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Releases waiters the moment their condition holds. */
class Waiters {
  private readonly pending: Array<{
    ready: () => boolean;
    resolve: () => void;
  }> = [];

  until(ready: () => boolean): Promise<void> {
    if (ready()) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.pending.push({ ready, resolve });
    });
  }

  notify(): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const waiter = this.pending[index]!;
      if (waiter.ready()) {
        this.pending.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}

/** Ordered string log a test can await by length. */
class EventLog {
  readonly entries: string[] = [];
  private readonly waiters = new Waiters();

  push(entry: string): void {
    this.entries.push(entry);
    this.waiters.notify();
  }

  until(length: number): Promise<void> {
    return this.waiters.until(() => this.entries.length >= length);
  }
}

class GateableRenderManager implements RenderManager {
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  setCharacter = vi.fn((_character: Character) => undefined);
  setLocalGaze = vi.fn((_coords: GazeCoordinates) => false);
  setEventBus = vi.fn((_eventBus: CharivoEventBus) => undefined);
  disconnect = vi.fn(() => undefined);

  /** Renders whose message matches stay pending until settled explicitly. */
  hold: (message: Message) => boolean = () => false;
  readonly calls: Array<{
    message: Message;
    character?: Character;
    gate?: Deferred<void>;
  }> = [];
  private readonly waiters = new Waiters();

  render = vi.fn(async (message: Message, character?: Character) => {
    const call: {
      message: Message;
      character?: Character;
      gate?: Deferred<void>;
    } = { message, character };

    if (this.hold(message)) {
      call.gate = createDeferred<void>();
    }

    this.calls.push(call);
    this.waiters.notify();

    if (call.gate) {
      await call.gate.promise;
    }
  });

  rendered(): string[] {
    return this.calls.map((call) => describeMessage(call.message));
  }

  waitForCalls(count: number): Promise<void> {
    return this.waiters.until(() => this.calls.length >= count);
  }

  settle(match: (message: Message) => boolean = () => true): void {
    for (const call of this.calls) {
      if (call.gate && match(call.message)) {
        call.gate.resolve();
      }
    }
  }

  fail(error: Error, match: (message: Message) => boolean = () => true): void {
    for (const call of this.calls) {
      if (call.gate && match(call.message)) {
        call.gate.reject(error);
      }
    }
  }
}

class GateableTTSManager implements TTSManager {
  /** Which stop()/speak() calls park until settled explicitly. */
  holdStop: (callIndex: number) => boolean = () => false;
  holdSpeak: (text: string) => boolean = () => false;
  readonly stopCalls: Array<{ gate?: Deferred<void> }> = [];
  readonly speakCalls: Array<{
    text: string;
    options?: TTSOptions;
    gate?: Deferred<void>;
  }> = [];
  private readonly waiters = new Waiters();

  stop = vi.fn(async () => {
    const call: { gate?: Deferred<void> } = {};

    if (this.holdStop(this.stopCalls.length)) {
      call.gate = createDeferred<void>();
    }

    this.stopCalls.push(call);
    this.waiters.notify();

    if (call.gate) {
      await call.gate.promise;
    }
  });

  speak = vi.fn(async (text: string, options?: TTSOptions) => {
    const call: {
      text: string;
      options?: TTSOptions;
      gate?: Deferred<void>;
    } = { text, options };

    if (this.holdSpeak(text)) {
      call.gate = createDeferred<void>();
    }

    this.speakCalls.push(call);
    this.waiters.notify();

    if (call.gate) {
      await call.gate.promise;
    }
  });

  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);

  spokenTexts(): string[] {
    return this.speakCalls.map((call) => call.text);
  }

  waitForStops(count: number): Promise<void> {
    return this.waiters.until(() => this.stopCalls.length >= count);
  }

  waitForSpeaks(count: number): Promise<void> {
    return this.waiters.until(() => this.speakCalls.length >= count);
  }

  settleStop(index: number): void {
    this.stopCalls[index]?.gate?.resolve();
  }

  failStop(index: number, error: Error): void {
    this.stopCalls[index]?.gate?.reject(error);
  }

  settleSpeak(match: (text: string) => boolean): void {
    for (const call of this.speakCalls) {
      if (call.gate && match(call.text)) {
        call.gate.resolve();
      }
    }
  }

  failSpeak(match: (text: string) => boolean, error: Error): void {
    for (const call of this.speakCalls) {
      if (call.gate && match(call.text)) {
        call.gate.reject(error);
      }
    }
  }
}

class GateableLLMClient implements LLMClient {
  /**
   * Reply text to answer with immediately, or null to park the call until the
   * test settles it. Throwing makes the call reject.
   */
  responder: (lastContent: string) => string | null = (content) =>
    `reply-${content}`;
  readonly prompts: Array<Array<{ role: string; content: string }>> = [];
  private readonly gates: Array<Deferred<string> | undefined> = [];
  private readonly waiters = new Waiters();

  call = vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    this.prompts.push(messages);
    const immediate = this.responder(lastContentOf(messages));

    if (immediate !== null) {
      this.gates.push(undefined);
      this.waiters.notify();
      return immediate;
    }

    const gate = createDeferred<string>();
    this.gates.push(gate);
    this.waiters.notify();
    return gate.promise;
  });

  waitForCalls(count: number): Promise<void> {
    return this.waiters.until(() => this.prompts.length >= count);
  }

  /** True when some prompt was built for a turn whose newest message is `content`. */
  calledFor(content: string): boolean {
    return this.prompts.some((prompt) => lastContentOf(prompt) === content);
  }

  promptFor(content: string): Array<{ role: string; content: string }> {
    const prompt = this.prompts.find(
      (candidate) => lastContentOf(candidate) === content,
    );

    if (!prompt) {
      throw new Error(`No LLM prompt was built for "${content}"`);
    }

    return prompt;
  }

  resolveCall(content: string, reply: string): void {
    this.pendingGate(content).resolve(reply);
  }

  rejectCall(content: string, error: Error): void {
    this.pendingGate(content).reject(error);
  }

  private pendingGate(content: string): Deferred<string> {
    const index = this.prompts.findIndex(
      (prompt, position) =>
        this.gates[position] !== undefined && lastContentOf(prompt) === content,
    );

    if (index === -1) {
      throw new Error(`No pending LLM call for "${content}"`);
    }

    return this.gates[index]!;
  }
}

/**
 * Custom LLMManager stub: only a manager can call back into Charivo, so the
 * reentrancy tests need one. It records the order of its addToHistory
 * arguments, which is the Charivo-side write ordering under test.
 */
class RecordingLLMManager implements LLMManager {
  readonly added: Message[] = [];
  readonly generated: Message[] = [];
  /** Runs inside addToHistory -- the one place a manager can reenter Charivo. */
  onAdd: (message: Message) => void = () => undefined;
  onGenerate: (message: Message) => void = () => undefined;
  emitter?: CharivoEventEmitter;

  setCharacter = vi.fn((_character: Character) => undefined);
  getCharacter = vi.fn((): Character | null => null);
  clearHistory = vi.fn(() => undefined);
  getHistory = vi.fn((): Message[] => []);
  addToHistory = vi.fn((message: Message): HistoryRollback => {
    this.added.push(message);
    this.onAdd(message);
    return () => undefined;
  });
  generateResponse = vi.fn(
    async (message: Message, _options?: GenerateResponseOptions) => {
      this.generated.push(message);
      this.onGenerate(message);
      return `reply-${message.content}`;
    },
  );
  setEventEmitter = vi.fn((eventEmitter: CharivoEventEmitter) => {
    this.emitter = eventEmitter;
  });

  addedContents(): string[] {
    return this.added.map((message) => message.content);
  }

  generatedContents(): string[] {
    return this.generated.map((message) => message.content);
  }
}

/**
 * ControllableTTSManager's session semantics plus a label, so a test running
 * two managers can tell whose audio events these are. Audio events go into a
 * shared log instead of the bus, which keeps them orderable against bus
 * events without changing any payload shape.
 */
class LabeledTTSManager implements TTSManager {
  private sessionSeq = 0;
  private activeSession: number | null = null;
  private readonly gates = new Map<number, () => void>();

  constructor(
    private readonly label: string,
    private readonly log: EventLog,
  ) {}

  speak = vi.fn(async (_text: string, _options?: TTSOptions) => {
    await this.stop();

    const session = ++this.sessionSeq;
    this.activeSession = session;
    this.log.push(`audio:start(${this.label})`);

    await new Promise<void>((resolve) => this.gates.set(session, resolve));

    if (this.gates.delete(session)) {
      this.activeSession = null;
      this.log.push(`audio:end(${this.label})`);
    }
  });

  stop = vi.fn(async () => {
    if (this.activeSession === null) return;

    const session = this.activeSession;
    this.activeSession = null;
    this.log.push(`audio:end(${this.label})`);

    const resolveGate = this.gates.get(session);
    if (resolveGate) {
      this.gates.delete(session);
      resolveGate();
    }
  });

  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);

  getActiveSession(): number | null {
    return this.activeSession;
  }

  finishUtterance(session: number): void {
    this.gates.get(session)?.();
  }
}

/**
 * Records the turn lifecycle in emission order and maps message ids back to
 * the text their turn started with, so assertions can name turns by content.
 * Constructed first, so bus registration order makes this the earliest
 * observer of everything it records.
 */
class TurnRecorder {
  readonly log: string[] = [];
  private readonly contentById = new Map<string, string>();

  constructor(charivo: Charivo) {
    charivo.on("message:sent", ({ message }) => {
      this.contentById.set(message.id, message.content);
      this.log.push(`sent:${message.content}`);
    });
    charivo.on("turn:cancelled", ({ userMessageId }) => {
      this.log.push(
        `cancelled:${this.contentById.get(userMessageId) ?? `<unknown ${userMessageId}>`}`,
      );
    });
  }

  get sent(): string[] {
    return this.entriesOf("sent:");
  }

  get cancelled(): string[] {
    return this.entriesOf("cancelled:");
  }

  private entriesOf(prefix: string): string[] {
    return this.log
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length));
  }
}

function lastContentOf(messages: Array<{ content: string }>): string {
  return messages[messages.length - 1]?.content ?? "";
}

function describeMessage(message: Message): string {
  return `${message.type}:${message.content}`;
}

/** History as `type:content` pairs, so contents are compared, not just shape. */
function transcript(messages: Message[]): string[] {
  return messages.map(describeMessage);
}

let seededMessages = 0;
function buildMessage(content: string, type: Message["type"]): Message {
  seededMessages += 1;
  return {
    id: `seed-${seededMessages}`,
    content,
    timestamp: new Date(),
    type,
  };
}

describe("Charivo latest-wins turns", () => {
  const character: Character = {
    id: "char-1",
    name: "Hiyori",
    description: "A cheerful assistant",
    personality: "Always upbeat",
    voice: { voiceId: "alloy", rate: 1.5, pitch: 1.2, volume: 0.8 },
  };

  const otherCharacter: Character = {
    id: "char-2",
    name: "Nagi",
    description: "A calm assistant",
    personality: "Measured",
    voice: { voiceId: "echo", rate: 0.5, pitch: 0.7, volume: 0.4 },
  };

  interface Harness {
    charivo: Charivo;
    render: GateableRenderManager;
    tts: GateableTTSManager;
    client: GateableLLMClient;
    manager: LLMManagerWithTools;
    recorder: TurnRecorder;
  }

  function createHarness(
    options: {
      renderer?: boolean;
      llm?: boolean;
      tts?: boolean;
      maxHistoryTurns?: number;
    } = {},
  ): Harness {
    const {
      renderer = true,
      llm = true,
      tts = false,
      maxHistoryTurns,
    } = options;
    const render = new GateableRenderManager();
    const ttsManager = new GateableTTSManager();
    const client = new GateableLLMClient();
    const manager = createLLMManager(
      client,
      maxHistoryTurns === undefined ? undefined : { maxHistoryTurns },
    );
    const charivo = new Charivo();
    const recorder = new TurnRecorder(charivo);

    if (renderer) charivo.attachRenderer(render);
    if (tts) charivo.attachTTS(ttsManager);
    if (llm) charivo.attachLLM(manager);
    charivo.setCharacter(character);

    return { charivo, render, tts: ttsManager, client, manager, recorder };
  }

  it("writes a superseded turn's message before announcing its cancellation", async () => {
    const { charivo, render } = createHarness();
    render.hold = (message) =>
      message.type === "user" && message.content === "A";

    const snapshots: string[][] = [];
    charivo.on("turn:cancelled", () => {
      snapshots.push(transcript(charivo.getHistory()));
    });

    const turnA = charivo.userSay("A");
    await render.waitForCalls(1);

    // The entry block is synchronous, so once this call returns the
    // predecessor has been flushed and announced -- while A is still parked in
    // its user render and B has not reached its own gate.
    const turnB = charivo.userSay("B");
    expect(snapshots).toEqual([["user:A"]]);

    render.settle();
    await turnA;
    await turnB;

    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "user:B",
      "character:reply-B",
    ]);
  });

  it("writes a superseded turn's message even when the manager was attached mid-flight", async () => {
    const { charivo, render, manager } = createHarness({ llm: false });
    render.hold = (message) =>
      message.type === "user" && message.content === "A";

    const snapshots: string[][] = [];
    charivo.on("turn:cancelled", () => {
      snapshots.push(transcript(charivo.getHistory()));
    });

    const turnA = charivo.userSay("A");
    await render.waitForCalls(1);
    charivo.attachLLM(manager);

    const turnB = charivo.userSay("B");
    expect(snapshots).toEqual([["user:A"]]);

    render.settle();
    await turnA;
    await turnB;

    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "user:B",
      "character:reply-B",
    ]);
  });

  it("keeps queue order in call order when a message:sent listener starts a nested turn", async () => {
    const { charivo, render, manager } = createHarness({ llm: false });
    render.hold = (message) =>
      message.type === "user" &&
      (message.content === "A" || message.content === "C");

    let started = false;
    let turnC: Promise<void> | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content !== "B" || started) return;
      started = true;
      turnC = charivo.userSay("C");
    });

    const turnA = charivo.userSay("A");
    await render.waitForCalls(1);

    // B is superseded inside its own entry block, so it never reaches a phase
    // that could be waited on -- it just resolves.
    await charivo.userSay("B");
    expect(render.rendered()).not.toContain("user:B");
    expect(charivo.getHistory()).toEqual([]);

    charivo.attachLLM(manager);
    render.settle();
    await turnA;
    await turnC;

    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "user:B",
      "user:C",
      "character:reply-C",
    ]);
  });

  it("makes a nested turn wait for older queued entries before appending its own", async () => {
    // No TTS and no render manager: a turn reaches its gate synchronously,
    // which is the shape in which a reentrant append could jump the queue.
    const charivo = new Charivo();
    charivo.setCharacter(character);

    const started = new Set<string>();
    let turnB: Promise<void> | undefined;
    let turnC: Promise<void> | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content === "A" && !started.has("B")) {
        started.add("B");
        turnB = charivo.userSay("B");
      }
      if (message.content === "B" && !started.has("C")) {
        started.add("C");
        turnC = charivo.userSay("C");
      }
    });

    // A superseded by B, B superseded by C: A and B stay queued, C completes.
    await charivo.userSay("A");
    await turnB;
    await turnC;

    const manager = new RecordingLLMManager();
    let turnD: Promise<void> | undefined;
    const addedWhenGenerating = new Map<string, string[]>();
    manager.onAdd = (message) => {
      if (message.content !== "A" || started.has("D")) return;
      started.add("D");
      turnD = charivo.userSay("D");
    };
    manager.onGenerate = (message) => {
      addedWhenGenerating.set(message.content, manager.addedContents());
    };
    charivo.attachLLM(manager);

    await charivo.userSay("outer");
    await turnD;

    expect(manager.addedContents()).toEqual([
      "A",
      "B",
      "outer",
      "D",
      "reply-D",
    ]);
    expect([...addedWhenGenerating.keys()]).toEqual(["D"]);
    expect(addedWhenGenerating.get("D")).toEqual(["A", "B", "outer", "D"]);
  });

  it("flushes queued messages at the next turn and leaves nothing behind for completed turns", async () => {
    const { charivo, render, manager } = createHarness({ llm: false });
    render.hold = (message) =>
      message.type === "user" &&
      (message.content === "A" || message.content === "B");

    const turnA = charivo.userSay("A");
    await render.waitForCalls(1);
    const turnB = charivo.userSay("B");
    await render.waitForCalls(2);

    // C is live, renderer-only, and completes with nothing to write.
    await charivo.userSay("C");

    render.settle();
    await turnA;
    await turnB;

    charivo.attachLLM(manager);
    expect(charivo.getHistory()).toEqual([]);

    await charivo.userSay("D");
    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "user:B",
      "user:D",
      "character:reply-D",
    ]);
  });

  it("leaves nothing queued when a live turn fails before reaching a manager", async () => {
    const { charivo, render, manager } = createHarness({ llm: false });
    render.hold = (message) => message.content === "A";

    const turnA = charivo.userSay("A");
    await render.waitForCalls(1);
    render.fail(new Error("render boom"));

    await expect(turnA).rejects.toBeInstanceOf(CharivoStateError);

    charivo.attachLLM(manager);
    await charivo.userSay("B");

    expect(transcript(charivo.getHistory())).toEqual([
      "user:B",
      "character:reply-B",
    ]);
  });

  it("keeps the newest turn active when a manager reenters userSay from the first addToHistory", async () => {
    const charivo = new Charivo();
    const tts = new GateableTTSManager();
    const render = new GateableRenderManager();
    const manager = new RecordingLLMManager();

    charivo.attachTTS(tts);
    charivo.attachRenderer(render);
    charivo.attachLLM(manager);
    charivo.setCharacter(character);
    render.hold = (message) =>
      message.type === "user" && message.content === "A";

    let reentered = false;
    let turnC: Promise<void> | undefined;
    manager.onAdd = () => {
      if (reentered) return;
      reentered = true;
      turnC = charivo.userSay("C");
    };

    const turnA = charivo.userSay("A");
    await render.waitForCalls(1);

    // B's entry-block flush writes A's queued message, which is where the
    // manager reenters -- before B has run its own pre-turn stop.
    await charivo.userSay("B");
    render.settle();
    await turnA;
    await turnC;

    expect(manager.generatedContents()).toEqual(["C"]);
    expect(tts.spokenTexts()).toEqual(["reply-C"]);
    // A's stop and C's stop only: B was already stale when its own would run.
    expect(tts.stopCalls).toHaveLength(2);
  });

  it("stops a turn superseded by a reentrant call from its own boundary commit", async () => {
    const charivo = new Charivo();
    const tts = new GateableTTSManager();
    const manager = new RecordingLLMManager();

    charivo.attachTTS(tts);
    charivo.attachLLM(manager);
    charivo.setCharacter(character);

    const ttsStarts: string[] = [];
    charivo.on("tts:start", ({ text }) => ttsStarts.push(text));

    let reentered = false;
    let turnC: Promise<void> | undefined;
    manager.onAdd = (message) => {
      // Keyed on the message, never on a call index: the calls along one turn
      // are the flushes' user writes and then the commit.
      if (message.type !== "character" || reentered) return;
      reentered = true;
      turnC = charivo.userSay("C");
    };

    await expect(charivo.userSay("B")).resolves.toBeUndefined();
    await turnC;

    expect(ttsStarts).not.toContain("reply-B");
    expect(tts.spokenTexts()).not.toContain("reply-B");
  });

  it("resolves a turn whose boundary commit reenters userSay and then throws", async () => {
    const charivo = new Charivo();
    const tts = new GateableTTSManager();
    const manager = new RecordingLLMManager();

    charivo.attachTTS(tts);
    charivo.attachLLM(manager);
    charivo.setCharacter(character);

    const ttsStarts: string[] = [];
    const ttsErrors: string[] = [];
    charivo.on("tts:start", ({ text }) => ttsStarts.push(text));
    charivo.on("tts:error", ({ error }) => ttsErrors.push(error.message));

    let reentered = false;
    let turnC: Promise<void> | undefined;
    manager.onAdd = (message) => {
      if (message.type !== "character" || reentered) return;
      reentered = true;
      turnC = charivo.userSay("C");
      throw new Error("commit boom");
    };

    await expect(charivo.userSay("B")).resolves.toBeUndefined();
    await turnC;

    expect(ttsStarts).not.toContain("reply-B");
    expect(ttsErrors).toEqual([]);
  });

  describe("phase cancellation", () => {
    interface PhaseDescriptor {
      name: string;
      /** Parks turn A in this phase; turn B passes through untouched. */
      arm: (harness: Harness) => void;
      /** Resolves once turn A is parked. */
      reached: (harness: Harness) => Promise<void>;
      settle: (harness: Harness, outcome: "resolve" | "reject") => void;
      /** Events turn A must never emit once superseded in this phase. */
      forbidden: string[];
      /** A passed the presentation boundary before it was held here. */
      commits: boolean;
      /** A had already entered its character render by then. */
      rendersReply: boolean;
      /** A had already issued its LLM request by then. */
      generates: boolean;
    }

    const failure = new Error("phase failure");

    const phases: PhaseDescriptor[] = [
      {
        name: "the pre-turn stop",
        arm: ({ tts }) => {
          tts.holdStop = (index) => index === 0;
        },
        reached: ({ tts }) => tts.waitForStops(1),
        settle: ({ tts }, outcome) =>
          outcome === "resolve" ? tts.settleStop(0) : tts.failStop(0, failure),
        forbidden: ["received:reply-A", "speak:reply-A", "tts:start:reply-A"],
        commits: false,
        rendersReply: false,
        generates: false,
      },
      {
        name: "the user render",
        arm: ({ render }) => {
          render.hold = (message) =>
            message.type === "user" && message.content === "A";
        },
        reached: ({ render }) => render.waitForCalls(1),
        settle: ({ render }, outcome) =>
          outcome === "resolve" ? render.settle() : render.fail(failure),
        forbidden: ["received:reply-A", "speak:reply-A", "tts:start:reply-A"],
        commits: false,
        rendersReply: false,
        generates: false,
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
        forbidden: ["received:reply-A", "speak:reply-A", "tts:start:reply-A"],
        commits: false,
        rendersReply: false,
        generates: true,
      },
      {
        name: "the character render",
        arm: ({ render }) => {
          render.hold = (message) =>
            message.type === "character" && message.content === "reply-A";
        },
        reached: ({ render }) => render.waitForCalls(2),
        settle: ({ render }, outcome) =>
          outcome === "resolve" ? render.settle() : render.fail(failure),
        forbidden: ["tts:start:reply-A"],
        commits: false,
        rendersReply: true,
        generates: true,
      },
      {
        name: "playback",
        arm: ({ tts }) => {
          tts.holdSpeak = (text) => text === "reply-A";
        },
        reached: ({ tts }) => tts.waitForSpeaks(1),
        settle: ({ tts }, outcome) =>
          outcome === "resolve"
            ? tts.settleSpeak((text) => text === "reply-A")
            : tts.failSpeak((text) => text === "reply-A", failure),
        forbidden: [],
        commits: true,
        rendersReply: true,
        generates: true,
      },
    ];

    for (const phase of phases) {
      for (const outcome of ["resolve", "reject"] as const) {
        it(`abandons a turn superseded during ${phase.name} (${outcome})`, async () => {
          const harness = createHarness({ tts: true });
          const { charivo, render, client } = harness;
          const events: string[] = [];

          charivo.on("message:received", ({ message }) =>
            events.push(`received:${message.content}`),
          );
          charivo.on("character:speak", ({ text }) =>
            events.push(`speak:${text}`),
          );
          charivo.on("tts:start", ({ text }) =>
            events.push(`tts:start:${text}`),
          );
          charivo.on("tts:end", () => events.push("tts:end"));
          charivo.on("tts:error", () => events.push("tts:error"));
          charivo.on("llm:error", () => events.push("llm:error"));

          phase.arm(harness);

          const turnA = charivo.userSay("A");
          await phase.reached(harness);

          await charivo.userSay("B");

          phase.settle(harness, outcome);
          await expect(turnA).resolves.toBeUndefined();

          const history = transcript(charivo.getHistory());

          // Retention is unconditional and rollback-free, on both settlements.
          expect(history.filter((entry) => entry === "user:A")).toHaveLength(1);
          expect(history).toContain("user:B");
          expect(history).toContain("character:reply-B");

          // The reply exists only if A had reached the presentation boundary.
          expect(history.includes("character:reply-A")).toBe(phase.commits);

          for (const forbidden of phase.forbidden) {
            expect(events).not.toContain(forbidden);
          }

          // Only B's playback ends; a stale turn emits neither tts:end nor an
          // error event, whichever way its pending operation settled.
          expect(events.filter((entry) => entry === "tts:end")).toHaveLength(1);
          expect(events).not.toContain("tts:error");
          expect(events).not.toContain("llm:error");

          expect(render.rendered().includes("character:reply-A")).toBe(
            phase.rendersReply,
          );
          expect(client.calledFor("A")).toBe(phase.generates);
        });
      }
    }
  });

  it("keeps history in call order and announces every predecessor under message:sent reentrancy", async () => {
    const { charivo, client, recorder } = createHarness({ renderer: false });
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;

    let started = false;
    let turnC: Promise<void> | undefined;
    charivo.on("message:sent", ({ message }) => {
      if (message.content !== "B" || started) return;
      started = true;
      turnC = charivo.userSay("C");
    });

    const turnA = charivo.userSay("A");
    await client.waitForCalls(1);

    await charivo.userSay("B");
    await turnC;

    client.resolveCall("A", "reply-A");
    await turnA;

    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "user:B",
      "user:C",
      "character:reply-C",
    ]);
    expect(
      client
        .promptFor("C")
        .filter((message) => message.role === "user")
        .map((message) => message.content),
    ).toEqual(["A", "B", "C"]);
    expect(recorder.log).toEqual([
      "sent:A",
      "sent:B",
      "sent:C",
      "cancelled:B",
      "cancelled:A",
    ]);
  });

  it("emits message:sent before any turn:cancelled naming that turn", async () => {
    const { charivo, client, recorder } = createHarness({ renderer: false });
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;

    // The recorder registered first, so it observes both events before the
    // listener below can start another turn from inside one of them.
    let started = false;
    let turnC: Promise<void> | undefined;
    charivo.on("turn:cancelled", () => {
      if (started) return;
      started = true;
      turnC = charivo.userSay("C");
    });

    const turnA = charivo.userSay("A");
    await client.waitForCalls(1);

    await charivo.userSay("B");
    await turnC;

    client.resolveCall("A", "reply-A");
    await turnA;

    expect(recorder.log).toEqual([
      "sent:A",
      "sent:B",
      "cancelled:A",
      "sent:C",
      "cancelled:B",
    ]);

    recorder.log.forEach((entry, index) => {
      if (!entry.startsWith("cancelled:")) return;
      expect(recorder.log.slice(0, index)).toContain(
        `sent:${entry.slice("cancelled:".length)}`,
      );
    });
  });

  it("announces a superseded empty-content turn without storing it", async () => {
    const { charivo, render, recorder } = createHarness();
    render.hold = (message) =>
      message.type === "user" && message.content === "";

    const turnA = charivo.userSay("");
    await render.waitForCalls(1);

    await charivo.userSay("B");
    render.settle();

    await expect(turnA).resolves.toBeUndefined();
    expect(recorder.cancelled).toEqual([""]);
    expect(transcript(charivo.getHistory())).toEqual([
      "user:B",
      "character:reply-B",
    ]);
  });

  it("keeps flushing to its own entry when the manager refuses an older queued message", async () => {
    const charivo = new Charivo();
    const render = new GateableRenderManager();
    charivo.attachRenderer(render);
    charivo.setCharacter(character);
    render.hold = (message) => message.content === "A";

    const turnA = charivo.userSay("A");
    await render.waitForCalls(1);
    await charivo.userSay("B");
    render.settle();
    await turnA;

    const attempts: Message[] = [];
    const manager = new RecordingLLMManager();
    manager.addToHistory = vi.fn((message: Message): HistoryRollback => {
      attempts.push(message);
      if (message.type === "user") {
        throw new CharivoStateError(
          "Message content must be a non-empty string",
        );
      }
      return () => undefined;
    });
    charivo.attachLLM(manager);

    await expect(charivo.userSay("C")).rejects.toBeInstanceOf(
      CharivoStateError,
    );
    expect(attempts.map((message) => message.content)).toEqual(["A", "C"]);
  });

  it("rolls back only the manager the turn wrote into when generation fails", async () => {
    const charivo = new Charivo();
    const render = new GateableRenderManager();
    const failingClient: LLMClient = {
      call: vi.fn(async () => {
        throw new Error("upstream failed");
      }),
    };
    const managerOne = createLLMManager(new GateableLLMClient(), {
      maxHistoryTurns: 1,
    });
    const managerTwo = createLLMManager(failingClient, { maxHistoryTurns: 1 });

    const prefill = (manager: LLMManager, tag: string): void => {
      manager.setCharacter(character);
      manager.addToHistory(buildMessage(`user-${tag}`, "user"));
      manager.addToHistory(buildMessage(`reply-${tag}`, "character"));
    };
    prefill(managerOne, "one");
    prefill(managerTwo, "two");

    charivo.attachRenderer(render);
    charivo.setCharacter(character);
    charivo.attachLLM(managerOne);
    render.hold = (message) =>
      message.type === "user" && message.content === "A";

    const turn = charivo.userSay("A");
    await render.waitForCalls(1);
    charivo.attachLLM(managerTwo);
    render.settle();

    await expect(turn).rejects.toBeInstanceOf(CharivoProviderError);
    expect(transcript(managerTwo.getHistory())).toEqual([
      "user:user-two",
      "character:reply-two",
    ]);
    expect(transcript(managerOne.getHistory())).toEqual([
      "user:user-one",
      "character:reply-one",
    ]);
  });

  it("never lets a late-attached manager commit an unspoken reply", async () => {
    const { charivo, render, manager } = createHarness({ llm: false });
    render.hold = (message) =>
      (message.type === "user" && message.content === "A") ||
      (message.type === "character" && message.content === "reply-A");

    const turnA = charivo.userSay("A");
    await render.waitForCalls(1);
    charivo.attachLLM(manager);
    render.settle((message) => message.type === "user");
    await render.waitForCalls(2);

    await charivo.userSay("B");
    render.settle();
    await turnA;

    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "user:B",
      "character:reply-B",
    ]);
  });

  it("reads the manager at the LLM step when it is attached during the pre-turn stop", async () => {
    const { charivo, tts, manager } = createHarness({
      llm: false,
      renderer: false,
      tts: true,
    });
    tts.holdStop = (index) => index === 0;

    const turn = charivo.userSay("A");
    await tts.waitForStops(1);
    charivo.attachLLM(manager);
    tts.settleStop(0);

    await expect(turn).resolves.toBeUndefined();
    expect(transcript(manager.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);
  });

  it("reads the manager at the LLM step when it is attached during the user render", async () => {
    const { charivo, render, manager } = createHarness({ llm: false });
    render.hold = (message) => message.type === "user";

    const turn = charivo.userSay("A");
    await render.waitForCalls(1);
    charivo.attachLLM(manager);
    render.settle();

    await expect(turn).resolves.toBeUndefined();
    expect(transcript(manager.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);
  });

  it("reads the character at each use when it is swapped during the user render", async () => {
    const { charivo, render, tts } = createHarness({ tts: true });
    render.hold = (message) => message.type === "user";

    const speaks: Array<{ id: string; text: string }> = [];
    const receivedCharacterIds: Array<string | undefined> = [];
    charivo.on("character:speak", ({ character: spoken, text }) =>
      speaks.push({ id: spoken.id, text }),
    );
    charivo.on("message:received", ({ message }) =>
      receivedCharacterIds.push(message.characterId),
    );

    const turn = charivo.userSay("A");
    await render.waitForCalls(1);
    charivo.setCharacter(otherCharacter);
    render.settle();
    await turn;

    expect(speaks).toEqual([{ id: otherCharacter.id, text: "reply-A" }]);
    expect(receivedCharacterIds).toEqual([otherCharacter.id]);
    expect(tts.speakCalls[0]?.options).toMatchObject({
      voice: otherCharacter.voice?.voiceId,
      rate: otherCharacter.voice?.rate,
      pitch: otherCharacter.voice?.pitch,
      volume: otherCharacter.voice?.volume,
    });
  });

  it("reads the character at each use when it is swapped during generation", async () => {
    const { charivo, tts, client } = createHarness({
      renderer: false,
      tts: true,
    });
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;

    const speaks: Array<{ id: string; text: string }> = [];
    const receivedCharacterIds: Array<string | undefined> = [];
    charivo.on("character:speak", ({ character: spoken, text }) =>
      speaks.push({ id: spoken.id, text }),
    );
    charivo.on("message:received", ({ message }) =>
      receivedCharacterIds.push(message.characterId),
    );

    const turn = charivo.userSay("A");
    await client.waitForCalls(1);
    charivo.setCharacter(otherCharacter);
    client.resolveCall("A", "reply-A");
    await turn;

    expect(speaks).toEqual([{ id: otherCharacter.id, text: "reply-A" }]);
    expect(receivedCharacterIds).toEqual([otherCharacter.id]);
    expect(tts.speakCalls[0]?.options).toMatchObject({
      voice: otherCharacter.voice?.voiceId,
    });
  });

  for (const phase of ["the pre-turn stop", "the user render"] as const) {
    for (const method of ["clearHistory", "setCharacter"] as const) {
      it(`keeps today's outcome when ${method} lands during ${phase}`, async () => {
        const { charivo, render, tts, recorder } = createHarness({ tts: true });
        await charivo.userSay("one");

        if (phase === "the pre-turn stop") {
          tts.holdStop = () => true;
        } else {
          render.hold = (message) =>
            message.type === "user" && message.content === "two";
        }

        const turn = charivo.userSay("two");
        if (phase === "the pre-turn stop") {
          await tts.waitForStops(2);
        } else {
          await render.waitForCalls(3);
        }

        if (method === "clearHistory") {
          charivo.clearHistory();
        } else {
          charivo.setCharacter(otherCharacter);
        }

        if (phase === "the pre-turn stop") {
          tts.settleStop(1);
        } else {
          render.settle();
        }
        await turn;

        expect(transcript(charivo.getHistory())).toEqual([
          "user:two",
          "character:reply-two",
        ]);
        expect(recorder.cancelled).toEqual([]);
      });
    }
  }

  for (const method of ["clearHistory", "setCharacter"] as const) {
    it(`keeps today's outcome when ${method} lands during generation`, async () => {
      const { charivo, client, recorder } = createHarness({ renderer: false });
      await charivo.userSay("one");

      client.responder = (content) =>
        content === "two" ? null : `reply-${content}`;
      const turn = charivo.userSay("two");
      await client.waitForCalls(2);

      if (method === "clearHistory") {
        charivo.clearHistory();
      } else {
        charivo.setCharacter(otherCharacter);
      }

      client.resolveCall("two", "reply-two");
      await turn;

      expect(transcript(charivo.getHistory())).toEqual(["character:reply-two"]);
      expect(recorder.cancelled).toEqual([]);
    });
  }

  it("keeps today's behavior for an empty assistant reply", async () => {
    const { charivo, tts, client } = createHarness({
      renderer: false,
      tts: true,
    });
    client.responder = () => "";

    const received: string[] = [];
    const spoken: string[] = [];
    charivo.on("message:received", ({ message }) =>
      received.push(message.content),
    );
    charivo.on("character:speak", ({ text }) => spoken.push(text));

    await expect(charivo.userSay("A")).resolves.toBeUndefined();

    expect(received).toEqual([""]);
    expect(spoken).toEqual([""]);
    expect(tts.spokenTexts()).toEqual([""]);
    expect(transcript(charivo.getHistory())).toEqual(["user:A", "character:"]);
  });

  it("restores a bound-full history when a live turn's generation fails", async () => {
    const { charivo, client } = createHarness({
      renderer: false,
      maxHistoryTurns: 1,
    });
    await charivo.userSay("one");

    client.responder = () => {
      throw new Error("upstream failed");
    };

    await expect(charivo.userSay("two")).rejects.toBeInstanceOf(
      CharivoProviderError,
    );
    expect(transcript(charivo.getHistory())).toEqual([
      "user:one",
      "character:reply-one",
    ]);
  });

  it("leaves a bound-full history untouched when the user render fails", async () => {
    const { charivo, render } = createHarness({ maxHistoryTurns: 1 });
    await charivo.userSay("one");

    render.hold = (message) =>
      message.type === "user" && message.content === "two";
    const turn = charivo.userSay("two");
    await render.waitForCalls(3);
    render.fail(new Error("render boom"));

    await expect(turn).rejects.toBeInstanceOf(CharivoStateError);
    expect(transcript(charivo.getHistory())).toEqual([
      "user:one",
      "character:reply-one",
    ]);
  });

  it("keeps the user message and drops the reply when the character render fails", async () => {
    const { charivo, render } = createHarness({ maxHistoryTurns: 1 });
    await charivo.userSay("one");

    render.hold = (message) =>
      message.type === "character" && message.content === "reply-two";
    const turn = charivo.userSay("two");
    await render.waitForCalls(4);
    render.fail(new Error("render boom"));

    await expect(turn).rejects.toBeInstanceOf(CharivoStateError);
    expect(transcript(charivo.getHistory())).toEqual(["user:two"]);
  });

  it("keeps a live TTS failure non-fatal and keeps the committed reply", async () => {
    const { charivo, tts } = createHarness({ renderer: false, tts: true });
    tts.speak.mockRejectedValueOnce(new Error("tts failed"));

    const errors: string[] = [];
    charivo.on("tts:error", ({ error }) => errors.push(error.message));

    await expect(charivo.userSay("A")).resolves.toBeUndefined();

    expect(errors).toEqual(["tts failed"]);
    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
    ]);
  });

  it("does not announce a cancellation for a turn that failed on its own", async () => {
    const { charivo, client, recorder } = createHarness({ renderer: false });
    client.responder = () => {
      throw new Error("upstream failed");
    };

    await expect(charivo.userSay("A")).rejects.toBeInstanceOf(
      CharivoProviderError,
    );

    client.responder = (content) => `reply-${content}`;
    await charivo.userSay("B");

    expect(recorder.cancelled).toEqual([]);
  });

  it("emits no cancellation for sequential turns", async () => {
    const { charivo, recorder } = createHarness({ tts: true });

    await charivo.userSay("A");
    await charivo.userSay("B");

    expect(recorder.log).toEqual(["sent:A", "sent:B"]);
  });

  it("announces each superseded turn exactly once under reentrant cancellation", async () => {
    const { charivo, client, recorder } = createHarness({ renderer: false });
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;

    let started = false;
    let turnC: Promise<void> | undefined;
    charivo.on("turn:cancelled", () => {
      if (started) return;
      started = true;
      turnC = charivo.userSay("C");
    });

    const turnA = charivo.userSay("A");
    await client.waitForCalls(1);

    await charivo.userSay("B");
    await turnC;

    client.resolveCall("A", "reply-A");
    await turnA;

    expect(recorder.cancelled).toEqual(["A", "B"]);
    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "user:B",
      "user:C",
      "character:reply-C",
    ]);
  });

  it("starts no awaited work in a turn superseded from inside its own announcement", async () => {
    const { charivo, tts, client, recorder } = createHarness({
      renderer: false,
      tts: true,
    });
    tts.holdSpeak = (text) => text === "reply-A";

    const turnA = charivo.userSay("A");
    await tts.waitForSpeaks(1);

    let started = false;
    let turnC: Promise<void> | undefined;
    charivo.on("turn:cancelled", () => {
      if (started) return;
      started = true;
      turnC = charivo.userSay("C");
    });

    await charivo.userSay("B");
    await turnC;
    tts.settleSpeak((text) => text === "reply-A");
    await turnA;

    expect(recorder.sent).toContain("B");
    expect(client.calledFor("B")).toBe(false);
    // A's stop and C's stop only: stale B never ran its own.
    expect(tts.stopCalls).toHaveLength(2);
    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "character:reply-A",
      "user:B",
      "user:C",
      "character:reply-C",
    ]);
  });

  for (const mode of ["attaches", "detaches"] as const) {
    it(`keeps stop-before-expression when a message:sent listener ${mode} the TTS manager`, async () => {
      const log = new EventLog();
      const ttsOne = new LabeledTTSManager("1", log);
      const ttsTwo = new LabeledTTSManager("2", log);
      const manager = new RecordingLLMManager();
      const charivo = new Charivo();

      manager.onGenerate = (message) => {
        // Stands in for a tool-driven avatar:expression during generation.
        if (message.content !== "B") return;
        manager.emitter?.emit("avatar:expression", { expressionId: "smile" });
      };

      charivo.attachTTS(ttsOne);
      charivo.attachLLM(manager);
      charivo.setCharacter(character);
      charivo.on("avatar:expression", () => log.push("expression"));

      const turnA = charivo.userSay("A");
      await log.until(1);

      let acted = false;
      charivo.on("message:sent", ({ message }) => {
        if (message.content !== "B" || acted) return;
        acted = true;
        if (mode === "attaches") {
          charivo.attachTTS(ttsTwo);
        } else {
          charivo.detachTTS();
        }
      });

      const turnB = charivo.userSay("B");
      await log.until(mode === "attaches" ? 4 : 3);

      expect(log.entries).toEqual(
        mode === "attaches"
          ? ["audio:start(1)", "audio:end(1)", "expression", "audio:start(2)"]
          : ["audio:start(1)", "audio:end(1)", "expression"],
      );

      await turnA;

      if (mode === "attaches") {
        ttsTwo.finishUtterance(ttsTwo.getActiveSession()!);
      }
      await expect(turnB).resolves.toBeUndefined();
    });
  }

  it("stops a turn superseded from its own pre-turn tts:error before it renders", async () => {
    const charivo = new Charivo();
    const render = new GateableRenderManager();
    const tts = new GateableTTSManager();
    const client = new GateableLLMClient();
    const manager = createLLMManager(client);

    tts.stop.mockImplementation(async () => {
      throw new Error("stop failed");
    });

    charivo.attachRenderer(render);
    charivo.attachTTS(tts);
    charivo.attachLLM(manager);
    charivo.setCharacter(character);

    let acted = false;
    let turnB: Promise<void> | undefined;
    charivo.on("tts:error", () => {
      if (acted) return;
      acted = true;
      turnB = charivo.userSay("B");
    });

    await expect(charivo.userSay("A")).resolves.toBeUndefined();
    await turnB;

    expect(render.rendered()).not.toContain("user:A");
    expect(client.calledFor("A")).toBe(false);
    expect(render.rendered()).toContain("user:B");
    expect(client.calledFor("B")).toBe(true);
    expect(tts.spokenTexts()).toEqual(["reply-B"]);
  });

  it("emits no character:speak from a turn superseded by a message:received listener", async () => {
    const { charivo } = createHarness({ tts: true });
    const speaks: string[] = [];
    charivo.on("character:speak", ({ text }) => speaks.push(text));

    let acted = false;
    let turnB: Promise<void> | undefined;
    charivo.on("message:received", ({ message }) => {
      if (message.content !== "reply-A" || acted) return;
      acted = true;
      turnB = charivo.userSay("B");
    });

    await charivo.userSay("A");
    await turnB;

    expect(speaks).toEqual(["reply-B"]);
  });

  it("never renders the character message of a turn superseded by a character:speak listener", async () => {
    const { charivo, render } = createHarness({ tts: true });

    let acted = false;
    let turnB: Promise<void> | undefined;
    charivo.on("character:speak", ({ text }) => {
      if (text !== "reply-A" || acted) return;
      acted = true;
      turnB = charivo.userSay("B");
    });

    await charivo.userSay("A");
    await turnB;

    expect(render.rendered()).not.toContain("character:reply-A");
    expect(render.rendered()).toContain("character:reply-B");
  });

  it("never speaks for a turn superseded by a tts:start listener", async () => {
    const { charivo, tts } = createHarness({ tts: true });

    let acted = false;
    let turnB: Promise<void> | undefined;
    charivo.on("tts:start", ({ text }) => {
      if (text !== "reply-A" || acted) return;
      acted = true;
      turnB = charivo.userSay("B");
    });

    await charivo.userSay("A");
    await turnB;

    expect(tts.spokenTexts()).toEqual(["reply-B"]);
  });

  it("skips the tool handler of a turn superseded by a tool:call listener", async () => {
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

    const charivo = new Charivo();
    charivo.attachLLM(createLLMManager(client, { tools: [tool] }));
    charivo.setCharacter(character);

    let acted = false;
    let turnB: Promise<void> | undefined;
    charivo.on("tool:call", () => {
      if (acted) return;
      acted = true;
      turnB = charivo.userSay("B");
    });

    await expect(charivo.userSay("A")).resolves.toBeUndefined();
    await turnB;

    // call-1 belongs to the superseded turn: announced, never executed.
    expect(handlerCalls).toEqual(["call-2"]);
    expect(transcript(charivo.getHistory())).toEqual([
      "user:A",
      "user:B",
      "character:final",
    ]);
  });

  it("gives every message a unique id inside one frozen millisecond", async () => {
    const { charivo } = createHarness({ renderer: false });
    const ids: string[] = [];
    charivo.on("message:sent", ({ message }) => ids.push(message.id));
    charivo.on("message:received", ({ message }) => ids.push(message.id));

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      await charivo.userSay("A");
      await charivo.userSay("B");
    } finally {
      nowSpy.mockRestore();
    }

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("keeps today's sequencing and typed error for invalid input", async () => {
    const { charivo, render, tts, recorder } = createHarness({ tts: true });

    const rejection = await charivo
      .userSay("")
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(CharivoStateError);
    expect((rejection as CharivoStateError).code).toBe("CHARIVO_STATE_ERROR");
    expect((rejection as CharivoStateError).message).toBe(
      "Message content must be a non-empty string",
    );
    expect(recorder.log).toEqual(["sent:"]);
    expect(render.rendered()).toEqual(["user:"]);
    expect(tts.stopCalls).toHaveLength(1);
    expect(charivo.getHistory()).toEqual([]);

    await charivo.userSay("B");
    expect(transcript(charivo.getHistory())).toEqual([
      "user:B",
      "character:reply-B",
    ]);
  });

  it("keeps the public emit passthrough ungated after a supersession", async () => {
    const { charivo, client } = createHarness({ renderer: false });
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;

    const expressions: string[] = [];
    charivo.on("avatar:expression", ({ expressionId }) =>
      expressions.push(expressionId),
    );

    const turnA = charivo.userSay("A");
    await client.waitForCalls(1);
    await charivo.userSay("B");

    charivo.emit("avatar:expression", { expressionId: "smile" });
    expect(expressions).toEqual(["smile"]);

    client.resolveCall("A", "reply-A");
    await turnA;
  });

  it("keeps the bound after a cancellation without stranding an orphan reply", async () => {
    const { charivo, client } = createHarness({
      renderer: false,
      maxHistoryTurns: 1,
    });
    client.responder = (content) =>
      content === "A" ? null : `reply-${content}`;

    const turnA = charivo.userSay("A");
    await client.waitForCalls(1);
    await charivo.userSay("B");

    client.resolveCall("A", "reply-A");
    await turnA;

    const history = charivo.getHistory();
    expect(transcript(history)).toEqual(["user:B", "character:reply-B"]);
    expect(history[0].type).toBe("user");
  });
});
