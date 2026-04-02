import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  Emotion,
  EventBus,
  type Character,
  type Message,
  type Renderer,
} from "@charivo/core";
import { createRenderManager } from "../src";
import { RealTimeLipSync } from "../src/lipsync";

class StubRenderer implements Renderer {
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  render = vi.fn(
    async (_message: Message, _character?: Character) => undefined,
  );
  playExpression = vi.fn((_expressionId: string) => undefined);
  playMotionByGroup = vi.fn((_group: string, _index: number) => undefined);
  setRealtimeLipSync = vi.fn((_enabled: boolean) => undefined);
  updateRealtimeLipSyncRms = vi.fn((_rms: number) => undefined);
}

describe("RenderManager", () => {
  let connectToAudioSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;
  let cleanupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    connectToAudioSpy = vi
      .spyOn(RealTimeLipSync.prototype, "connectToAudio")
      .mockImplementation(() => undefined);
    stopSpy = vi
      .spyOn(RealTimeLipSync.prototype, "stop")
      .mockImplementation(() => undefined);
    cleanupSpy = vi
      .spyOn(RealTimeLipSync.prototype, "cleanup")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes, renders messages, invokes the callback, and destroys cleanly", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const callback = vi.fn();
    const character: Character = {
      id: "hiyori",
      name: "Hiyori",
      description: "Assistant",
      personality: "Cheerful",
    };
    const message: Message = {
      id: "m1",
      content: "hello",
      timestamp: new Date(),
      type: "user",
    };

    manager.setCharacter(character);
    manager.setMessageCallback(callback);

    await manager.initialize();
    await manager.render(message);
    await manager.destroy();

    expect(renderer.initialize).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith(message, character);
    expect(callback).toHaveBeenCalledWith(message, character);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it("forwards TTS and realtime events through the typed event bus", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new EventBus();
    const character: Character = {
      id: "hiyori",
      name: "Hiyori",
      description: "Assistant",
      personality: "Cheerful",
      emotionMappings: [
        {
          emotion: Emotion.HAPPY,
          expression: "exp_happy",
          motion: { group: "TapBody", index: 1 },
        },
      ],
    };

    manager.setCharacter(character);
    manager.setEventBus(bus);

    const audio = document.createElement("audio");
    bus.emit("tts:audio:start", { audioElement: audio });
    bus.emit("tts:lipsync:update", { rms: 0.42 });
    bus.emit("tts:audio:end", {});
    bus.emit("realtime:emotion", { emotion: Emotion.HAPPY });

    expect(renderer.setRealtimeLipSync).toHaveBeenNthCalledWith(1, true);
    expect(connectToAudioSpy).toHaveBeenCalledWith(audio, expect.any(Function));
    expect(renderer.updateRealtimeLipSyncRms).toHaveBeenCalledWith(0.42);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(renderer.setRealtimeLipSync).toHaveBeenNthCalledWith(2, false);
    expect(renderer.playExpression).toHaveBeenCalledWith("exp_happy");
    expect(renderer.playMotionByGroup).toHaveBeenCalledWith("TapBody", 1);
  });

  it("plays mapped emotion animation before rendering character messages", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const character: Character = {
      id: "hiyori",
      name: "Hiyori",
      description: "Assistant",
      personality: "Cheerful",
      emotionMappings: [
        {
          emotion: Emotion.SAD,
          expression: "exp_sad",
          motion: { group: "Idle", index: 0 },
        },
      ],
    };
    const message: Message = {
      id: "m2",
      content: "I understand.",
      timestamp: new Date(),
      type: "character",
      emotion: Emotion.SAD,
    };

    await manager.render(message, character);

    expect(renderer.playExpression).toHaveBeenCalledWith("exp_sad");
    expect(renderer.playMotionByGroup).toHaveBeenCalledWith("Idle", 0);
    expect(renderer.render).toHaveBeenCalledWith(message, character);
  });
});
