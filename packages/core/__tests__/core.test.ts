import { describe, expect, it, vi } from "vitest";
import {
  Charivo,
  CharivoError,
  CharivoProviderError,
  CharivoTransportError,
} from "@charivo/core";
import type {
  Character,
  CharivoEventBus,
  CharivoEventEmitter,
  GazeCoordinates,
  LLMClient,
  LLMManager,
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
