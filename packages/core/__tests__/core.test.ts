import { describe, expect, it, vi } from "vitest";
import {
  Charivo,
  CharivoError,
  CharivoProviderError,
  CharivoTransportError,
  EventBus,
} from "@charivo/core";
import type {
  Character,
  CharivoEventBus,
  CharivoEventEmitter,
  LLMClient,
  Message,
  RealtimeManager,
  RealtimeState,
  RenderManager,
  RealtimeTool,
  RealtimeToolRegistration,
  STTManager,
  TTSManager,
  TTSOptions,
} from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { createRealtimeManager } from "@charivo/realtime";

class StubRenderManager implements RenderManager {
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  render = vi.fn(
    async (_message: Message, _character?: Character) => undefined,
  );
  setCharacter = vi.fn((_character: Character) => undefined);
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
  registerTool = vi.fn((_tool: RealtimeToolRegistration) => undefined);
  unregisterTool = vi.fn((_name: string) => undefined);
  getRegisteredTools = vi.fn((): RealtimeTool[] => []);
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);
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
      message: "Nice to meet you!",
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

    charivo.on("realtime:text:delta", customListener);
    charivo.emit("realtime:text:delta", { text: "partial" });
    expect(customListener).toHaveBeenCalledWith({ text: "partial" });

    charivo.off("realtime:text:delta", customListener);
    charivo.emit("realtime:text:delta", { text: "ignored" });
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
