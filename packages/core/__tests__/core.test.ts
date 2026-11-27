import { describe, expect, it, vi } from "vitest";
import {
  Charivo,
  CharivoError,
  CharivoStateError,
  CharivoTransportError,
  createCharivo,
} from "@charivo/core";
import type {
  Character,
  CharacterBody,
  ConversationBrain,
  CharivoEventBus,
  CharivoEventEmitter,
  GazeCoordinates,
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
  loadModel = vi.fn(async (_modelPath: string) => undefined);
  setMessageCallback = vi.fn(
    (_callback: (message: Message, character?: Character) => void) => undefined,
  );
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

function createBrain() {
  return {
    setBody: vi.fn((_body: CharacterBody | null) => undefined),
    setCharacter: vi.fn((_character: Character) => undefined),
    submit: vi.fn(),
    interrupt: vi.fn(async () => undefined),
    clearHistory: vi.fn(() => undefined),
    getHistory: vi.fn((): Message[] => []),
    dispose: vi.fn(async () => undefined),
  } satisfies ConversationBrain;
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

  it("still dispatches to a listener whose predecessor unsubscribed mid-emit", () => {
    // Regression: emit() used to iterate the live array, so a listener
    // calling off() (as RenderManager.disconnect() does, six at once)
    // spliced the array and shifted the NEXT listener out of the dispatch.
    const bus = new EventBus();
    const payload = {
      message: {
        id: "1",
        content: "hello",
        timestamp: new Date(),
        type: "user" as const,
      },
    };

    const selfRemoving = vi.fn(() => {
      bus.off("message:sent", selfRemoving);
    });
    const next = vi.fn();

    bus.on("message:sent", selfRemoving);
    bus.on("message:sent", next);
    bus.emit("message:sent", payload);

    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);

    // The unsubscribe itself still sticks for future emits.
    bus.emit("message:sent", payload);
    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);
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

  it("propagates character and event wiring across attached managers", () => {
    const renderManager = new StubRenderManager();
    const ttsManager = new StubTTSManager();
    const sttManager = new StubSTTManager();
    const realtimeManager = new StubRealtimeManager();
    const brain = createBrain();
    const charivo = new Charivo();
    const customListener = vi.fn();

    charivo.setCharacter(character);
    charivo.attachRenderer(renderManager);
    charivo.attachTTS(ttsManager);
    charivo.attachSTT(sttManager);
    charivo.attachRealtime(realtimeManager);
    charivo.attachBrain(brain);

    expect(renderManager.setCharacter).toHaveBeenCalledWith(character);
    expect(brain.setCharacter).toHaveBeenCalledWith(character);
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
    charivo.detachBrain();
    charivo.detachRenderer();
    charivo.detachRealtime();

    expect(charivo.getSTTManager()).toBeUndefined();
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.getBrain()).toBeUndefined();
    expect(charivo.isRealtimeModeEnabled()).toBe(false);
    expect(renderManager.destroy).not.toHaveBeenCalled();
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
    const brain = createBrain();
    const charivo = new Charivo();

    brain.dispose.mockImplementation(async () => {
      calls.push("brain");
    });
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
    charivo.attachBrain(brain);
    charivo.setCharacter(character);

    await charivo.dispose();
    await charivo.dispose();

    expect(calls).toEqual(["brain", "realtime", "tts", "stt", "render"]);
    expect(charivo.getBrain()).toBeUndefined();
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
    const brain = createBrain();
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
    charivo.attachBrain(brain);

    await expect(charivo.dispose()).rejects.toMatchObject({
      name: "CharivoDisposeError",
      cause: expect.objectContaining({
        message: "realtime failed",
      }),
    });

    expect(brain.dispose).toHaveBeenCalledTimes(1);
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

describe("createCharivo", () => {
  const character: Character = {
    id: "hiyori",
    name: "Hiyori",
    personality: "Cheerful",
    voice: { voiceId: "marin" },
  };

  it("attaches every supplied manager", () => {
    const renderer = new StubRenderManager();
    const brain = createBrain();
    const tts = new StubTTSManager();
    const stt = new StubSTTManager();

    const charivo = createCharivo({ renderer, brain, tts, stt });

    // attach* is what wires the event plumbing, so a wired manager proves it ran
    expect(renderer.setEventBus).toHaveBeenCalledTimes(1);
    expect(brain.setBody).toHaveBeenCalledWith(charivo);
    expect(tts.setEventEmitter).toHaveBeenCalledTimes(1);
    expect(stt.setEventEmitter).toHaveBeenCalledTimes(1);
    expect(charivo.getRenderManager()).toBe(renderer);
    expect(charivo.getSTTManager()).toBe(stt);
  });

  it("applies the character to each character-aware manager exactly once", () => {
    const renderer = new StubRenderManager();
    const brain = createBrain();
    const realtime = new StubRealtimeManager();

    const charivo = createCharivo({ renderer, brain, realtime, character });

    // The factory attaches first and sets the character last, so no manager
    // gets it twice — attach* only re-applies a character that is already set.
    expect(renderer.setCharacter).toHaveBeenCalledTimes(1);
    expect(renderer.setCharacter).toHaveBeenCalledWith(character);
    expect(brain.setCharacter).toHaveBeenCalledTimes(1);
    expect(realtime.setCharacter).toHaveBeenCalledTimes(1);
    expect(charivo.getCurrentCharacter()).toEqual(character);
  });

  it("matches hand-wiring with attach* plus setCharacter", () => {
    const manual = new Charivo();
    const manualRenderer = new StubRenderManager();
    const manualBrain = createBrain();
    manual.attachRenderer(manualRenderer);
    manual.attachBrain(manualBrain);
    manual.setCharacter(character);

    const renderer = new StubRenderManager();
    const brain = createBrain();
    const built = createCharivo({ renderer, brain, character });

    expect(built.getCurrentCharacter()).toEqual(manual.getCurrentCharacter());
    expect(built.getRenderManager()).toBe(renderer);
    expect(renderer.setCharacter.mock.calls).toEqual(
      manualRenderer.setCharacter.mock.calls,
    );
    expect(brain.setCharacter.mock.calls).toEqual(
      manualBrain.setCharacter.mock.calls,
    );
  });

  it("enables realtime mode only when a realtime manager is supplied", () => {
    expect(
      createCharivo({ brain: createBrain() }).isRealtimeModeEnabled(),
    ).toBe(false);

    const realtime = new StubRealtimeManager();
    const charivo = createCharivo({ realtime });
    expect(charivo.isRealtimeModeEnabled()).toBe(true);
    expect(charivo.getRealtimeManager()).toBe(realtime);
  });

  it("builds a usable instance with no options", () => {
    const charivo = createCharivo();

    expect(charivo).toBeInstanceOf(Charivo);
    expect(charivo.getCurrentCharacter()).toBeNull();
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.getBrain()).toBeUndefined();
  });

  it("treats a null manager the same as an omitted one", () => {
    // Apps commonly hold optional managers as nullable state, so null has to
    // mean "not supplied" rather than being attached or throwing.
    const brain = createBrain();
    const charivo = createCharivo({
      brain,
      tts: null,
      stt: null,
      realtime: null,
      renderer: null,
      character: null,
    });

    expect(brain.setBody).toHaveBeenCalledWith(charivo);
    expect(charivo.getCurrentCharacter()).toBeNull();
    expect(charivo.getRenderManager()).toBeUndefined();
    expect(charivo.getSTTManager()).toBeUndefined();
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.isRealtimeModeEnabled()).toBe(false);
  });
});

describe("Charivo manager getters", () => {
  it("exposes every attached manager", () => {
    const charivo = new Charivo();
    const renderer = new StubRenderManager();
    const brain = createBrain();
    const tts = new StubTTSManager();
    const stt = new StubSTTManager();
    const realtime = new StubRealtimeManager();

    charivo.attachRenderer(renderer);
    charivo.attachBrain(brain);
    charivo.attachTTS(tts);
    charivo.attachSTT(stt);
    charivo.attachRealtime(realtime);

    expect(charivo.getRenderManager()).toBe(renderer);
    expect(charivo.getBrain()).toBe(brain);
    expect(charivo.getTTSManager()).toBe(tts);
    expect(charivo.getSTTManager()).toBe(stt);
    expect(charivo.getRealtimeManager()).toBe(realtime);
  });

  it("returns undefined for every modality before anything is attached", () => {
    const charivo = new Charivo();

    expect(charivo.getRenderManager()).toBeUndefined();
    expect(charivo.getBrain()).toBeUndefined();
    expect(charivo.getTTSManager()).toBeUndefined();
    expect(charivo.getSTTManager()).toBeUndefined();
    expect(charivo.getRealtimeManager()).toBeUndefined();
  });

  it("stops exposing a manager once it is detached", () => {
    const charivo = createCharivo({
      brain: createBrain(),
      tts: new StubTTSManager(),
    });

    expect(charivo.getBrain()).toBeDefined();
    expect(charivo.getTTSManager()).toBeDefined();

    charivo.detachBrain();
    charivo.detachTTS();

    expect(charivo.getBrain()).toBeUndefined();
    expect(charivo.getTTSManager()).toBeUndefined();
  });
});

describe("Charivo brain port", () => {
  const character: Character = { id: "c1", name: "Test", personality: "" };

  it("gives an attached brain the body and, when set, the character", () => {
    const withoutCharacter = new Charivo();
    const first = createBrain();
    withoutCharacter.attachBrain(first);
    expect(first.setBody).toHaveBeenCalledWith(withoutCharacter);
    expect(first.setCharacter).not.toHaveBeenCalled();

    const withCharacter = new Charivo();
    withCharacter.setCharacter(character);
    const second = createBrain();
    withCharacter.attachBrain(second);
    expect(second.setBody).toHaveBeenCalledWith(withCharacter);
    expect(second.setCharacter).toHaveBeenCalledWith(character);
  });

  it("detaches the first brain when another is attached", () => {
    const charivo = new Charivo();
    const first = createBrain();
    const second = createBrain();

    charivo.attachBrain(first);
    charivo.attachBrain(second);

    expect(first.setBody).toHaveBeenLastCalledWith(null);
    expect(second.setBody).toHaveBeenCalledWith(charivo);
    expect(charivo.getBrain()).toBe(second);
  });

  it("refuses a brain another instance owns without touching its current brain", () => {
    const first = new Charivo();
    const second = new Charivo();
    const shared = createBrain();
    const own = createBrain();
    first.attachBrain(shared);
    second.attachBrain(own);

    expect(() => second.attachBrain(shared)).toThrow(CharivoStateError);

    expect(second.getBrain()).toBe(own);
    expect(own.setBody).not.toHaveBeenLastCalledWith(null);
    expect(shared.setBody).toHaveBeenCalledTimes(1);

    first.detachBrain();
    second.attachBrain(shared);
    expect(second.getBrain()).toBe(shared);
  });

  it("keeps the incoming brain from another body while the outgoing brain's detach runs", () => {
    const first = new Charivo();
    const second = new Charivo();
    const outgoing = createBrain();
    const incoming = createBrain();
    first.attachBrain(outgoing);
    let refusal: unknown;
    outgoing.setBody.mockImplementation((body) => {
      if (body === null) {
        try {
          second.attachBrain(incoming);
        } catch (error) {
          refusal = error;
        }
      }
    });

    first.attachBrain(incoming);

    expect(refusal).toBeInstanceOf(CharivoStateError);
    expect(first.getBrain()).toBe(incoming);
    expect(second.getBrain()).toBeUndefined();
  });

  it("keeps a newer brain the detach callback attached, and releases the incoming one", () => {
    const charivo = new Charivo();
    const other = new Charivo();
    const outgoing = createBrain();
    const incoming = createBrain();
    const newer = createBrain();
    charivo.attachBrain(outgoing);
    outgoing.setBody.mockImplementation((body) => {
      if (body === null) {
        charivo.attachBrain(newer);
      }
    });

    charivo.attachBrain(incoming);

    expect(charivo.getBrain()).toBe(newer);
    expect(() => other.attachBrain(incoming)).not.toThrow();
  });

  it("shares the ownership registry through globalThis", () => {
    const brain = createBrain();
    new Charivo().attachBrain(brain);

    const registry = (globalThis as Record<symbol, unknown>)[
      Symbol.for("@charivo/core.brainOwners")
    ] as WeakMap<object, unknown>;
    expect(registry.has(brain)).toBe(true);
  });

  it("leaves the running instance's TTS wiring alone when createCharivo() refuses an owned brain", () => {
    const brain = createBrain();
    const tts = {
      speak: vi.fn(),
      stop: vi.fn(),
      setVoice: vi.fn(),
      isSupported: vi.fn(() => true),
      setEventEmitter: vi.fn(),
    };
    createCharivo({ brain, tts });
    expect(tts.setEventEmitter).toHaveBeenCalledTimes(1);

    expect(() => createCharivo({ brain, tts })).toThrow(CharivoStateError);

    expect(tts.setEventEmitter).toHaveBeenCalledTimes(1);
  });

  it("detaches the brain when createCharivo() fails to set the character", () => {
    const brain = createBrain();
    brain.setCharacter.mockImplementationOnce(() => {
      throw new Error("bad character");
    });

    expect(() =>
      createCharivo({
        brain,
        character: { id: "c", name: "C" },
      }),
    ).toThrow("bad character");

    expect(() => new Charivo().attachBrain(brain)).not.toThrow();
  });

  it("detachBrain gives the brain a null body and forgets it", () => {
    const charivo = new Charivo();
    const brain = createBrain();
    charivo.attachBrain(brain);

    charivo.detachBrain();

    expect(brain.setBody).toHaveBeenLastCalledWith(null);
    expect(charivo.getBrain()).toBeUndefined();
    expect(() => charivo.detachBrain()).not.toThrow();
  });

  it("returns undefined from getBrain before one is attached", () => {
    expect(new Charivo().getBrain()).toBeUndefined();
  });

  it("passes setCharacter on to the brain", () => {
    const charivo = new Charivo();
    const brain = createBrain();
    charivo.attachBrain(brain);

    charivo.setCharacter(character);

    expect(brain.setCharacter).toHaveBeenCalledWith(character);
  });

  it("createCharivo attaches the brain option with the character", () => {
    const brain = createBrain();

    const charivo = createCharivo({ brain, character });

    expect(charivo.getBrain()).toBe(brain);
    expect(brain.setBody).toHaveBeenCalledWith(charivo);
    expect(brain.setCharacter).toHaveBeenCalledWith(character);
  });

  it("dispose awaits the brain's dispose, then detaches it", async () => {
    const charivo = new Charivo();
    const brain = createBrain();
    let settled = false;
    brain.dispose.mockImplementation(async () => {
      await Promise.resolve();
      settled = true;
    });
    charivo.attachBrain(brain);

    await charivo.dispose();

    expect(settled).toBe(true);
    expect(brain.setBody).toHaveBeenLastCalledWith(null);
    expect(charivo.getBrain()).toBeUndefined();
  });

  it("reports a brain dispose failure and still finishes the teardown", async () => {
    const tts = new StubTTSManager();
    const charivo = createCharivo({ tts });
    const brain = createBrain();
    const failure = new Error("brain dispose failed");
    brain.dispose.mockRejectedValueOnce(failure);
    charivo.attachBrain(brain);

    await expect(charivo.dispose()).rejects.toMatchObject({
      name: "CharivoDisposeError",
      cause: failure,
    });

    expect(brain.setBody).toHaveBeenLastCalledWith(null);
    expect(charivo.getBrain()).toBeUndefined();
    expect(tts.stop).toHaveBeenCalled();
    expect(charivo.getTTSManager()).toBeUndefined();
  });

  it("still finishes the teardown when the brain's setBody(null) throws", async () => {
    const tts = new StubTTSManager();
    const charivo = createCharivo({ tts });
    const brain = createBrain();
    const failure = new Error("setBody failed");
    charivo.attachBrain(brain);
    brain.setBody.mockImplementation((body) => {
      if (body === null) {
        throw failure;
      }
    });

    await expect(charivo.dispose()).rejects.toMatchObject({
      name: "CharivoDisposeError",
      cause: failure,
    });
    expect(charivo.getBrain()).toBeUndefined();
    expect(tts.stop).toHaveBeenCalled();
  });

  it("does not give a character to a brain that setBody() replaced", () => {
    const charivo = new Charivo();
    charivo.setCharacter(character);
    const first = createBrain();
    const second = createBrain();
    first.setBody.mockImplementation((body) => {
      if (body !== null) {
        charivo.attachBrain(second);
      }
    });

    charivo.attachBrain(first);

    expect(charivo.getBrain()).toBe(second);
    expect(first.setCharacter).not.toHaveBeenCalled();
    expect(second.setCharacter).toHaveBeenCalledWith(character);
  });
});
