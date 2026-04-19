import { describe, expect, it, vi } from "vitest";
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
import { Charivo, EventBus } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";

class StubRenderManager implements RenderManager {
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  render = vi.fn(
    async (_message: Message, _character?: Character) => undefined,
  );
  setCharacter = vi.fn((_character: Character) => undefined);
  setEventBus = vi.fn((_eventBus: CharivoEventBus) => undefined);
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

    expect(messageSpy).toHaveBeenCalledTimes(1);
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
    charivo.detachRealtime();

    expect(charivo.getSTTManager()).toBeUndefined();
    expect(charivo.getRealtimeManager()).toBeUndefined();
    expect(charivo.isRealtimeModeEnabled()).toBe(false);
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
});
