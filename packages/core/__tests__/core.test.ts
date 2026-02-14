import { describe, expect, it, vi } from "vitest";
import type { Character, LLMClient, Message, TTSOptions } from "@charivo/core";
import { Charivo, EventBus, hasEmotionTag } from "@charivo/core";
import { createLLMManager } from "@charivo/llm-core";

class StubRenderManager {
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  render = vi.fn(
    async (_message: Message, _character?: Character) => undefined,
  );
  setCharacter = vi.fn((_character: Character) => undefined);
  setEventBus = vi.fn((_eventBus: any) => undefined);
}

class StubTTSManager {
  speak = vi.fn(async (_text: string, _options?: TTSOptions) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((voice: string) => {
    this.voice = voice;
  });
  isSupported = vi.fn(() => true);
  setEventEmitter = vi.fn((_eventEmitter: any) => undefined);
  voice: string | undefined;
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

describe("Emotion Parser", () => {
  it("detects emotion tags consistently across repeated calls", () => {
    const text = "Hello! [happy]";

    expect(hasEmotionTag(text)).toBe(true);
    expect(hasEmotionTag(text)).toBe(true);
    expect(hasEmotionTag(text)).toBe(true);
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
});
