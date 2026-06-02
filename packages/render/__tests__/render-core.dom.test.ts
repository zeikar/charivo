import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventBus,
  type Character,
  type GazeCoordinates,
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
  lookAt = vi.fn((_coords: GazeCoordinates) => undefined);
  getAvailableExpressions = vi.fn(() => ["exp_happy", "exp_sad"]);
  getAvailableMotionGroups = vi.fn(() => ({
    TapBody: 2,
    Idle: 1,
  }));
  setRealtimeLipSync = vi.fn((_enabled: boolean) => undefined);
  updateRealtimeLipSyncRms = vi.fn((_rms: number) => undefined);
  updateViewWithMouse = vi.fn(
    (_coords: { clientX: number; clientY: number }) => undefined,
  );
  handleMouseTap = vi.fn(
    (_coords: { clientX: number; clientY: number }) => undefined,
  );
}

describe("RenderManager", () => {
  let connectToAudioSpy: ReturnType<typeof vi.spyOn>;
  let prepareAudioSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;
  let cleanupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useRealTimers();
    connectToAudioSpy = vi
      .spyOn(RealTimeLipSync.prototype, "connectToAudio")
      .mockImplementation(() => undefined);
    prepareAudioSpy = vi
      .spyOn(RealTimeLipSync.prototype, "prepareAudio")
      .mockResolvedValue(undefined);
    pauseSpy = vi
      .spyOn(RealTimeLipSync.prototype, "pause")
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

  it("forwards TTS and canonical realtime events through the typed event bus", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new EventBus();

    manager.setEventBus(bus);

    const audio = document.createElement("audio");
    bus.emit("tts:audio:start", { audioElement: audio });
    bus.emit("tts:lipsync:update", { rms: 0.42 });
    bus.emit("tts:audio:end", {});
    bus.emit("realtime:expression", { expressionId: "exp_happy" });
    bus.emit("realtime:motion", { group: "TapBody", index: 1 });
    bus.emit("realtime:gaze", { x: 0.25, y: -0.5 });

    expect(renderer.setRealtimeLipSync).toHaveBeenNthCalledWith(1, true);
    expect(connectToAudioSpy).toHaveBeenCalledWith(audio, expect.any(Function));
    expect(renderer.updateRealtimeLipSyncRms).toHaveBeenCalledWith(0.42);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(renderer.setRealtimeLipSync).toHaveBeenNthCalledWith(2, false);
    expect(renderer.playExpression).toHaveBeenCalledWith("exp_happy");
    expect(renderer.playMotionByGroup).toHaveBeenCalledWith("TapBody", 1);
    expect(renderer.lookAt).toHaveBeenCalledWith({ x: 0.25, y: -0.5 });
  });

  it("prepares audio on demand and pauses lip sync while hidden", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const originalVisibilityState = document.visibilityState;

    await manager.initialize();
    await manager.prepareAudio?.();
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));

    expect(prepareAudioSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).toHaveBeenCalledTimes(2);
    await manager.destroy();

    Object.defineProperty(document, "visibilityState", {
      value: originalVisibilityState,
      configurable: true,
    });
  });

  it("debounces repeated explicit expression and motion actions", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new EventBus();

    manager.setEventBus(bus);

    bus.emit("realtime:expression", { expressionId: "exp_happy" });
    bus.emit("realtime:expression", { expressionId: "exp_happy" });
    bus.emit("realtime:motion", { group: "TapBody", index: 1 });
    bus.emit("realtime:motion", { group: "TapBody", index: 1 });

    expect(renderer.playExpression).toHaveBeenCalledTimes(1);
    expect(renderer.playMotionByGroup).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    bus.emit("realtime:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(700);
    bus.emit("realtime:motion", { group: "TapBody", index: 1 });

    expect(renderer.playExpression).toHaveBeenCalledTimes(2);
    expect(renderer.playMotionByGroup).toHaveBeenCalledWith("TapBody", 1);
    expect(renderer.playMotionByGroup).toHaveBeenCalledTimes(2);
  });

  it("renders character messages without implicit avatar actions", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const character: Character = {
      id: "hiyori",
      name: "Hiyori",
      description: "Assistant",
      personality: "Cheerful",
    };
    const message: Message = {
      id: "m2",
      content: "I understand.",
      timestamp: new Date(),
      type: "character",
    };

    await manager.render(message, character);

    expect(renderer.playExpression).not.toHaveBeenCalled();
    expect(renderer.playMotionByGroup).not.toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledWith(message, character);
  });

  it("disconnect removes bus listeners (teardown, idempotency, re-wireable)", () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new EventBus();

    manager.setEventBus(bus);

    // First gaze emit — listener is wired
    bus.emit("realtime:gaze", { x: 1, y: 0 });
    expect(renderer.lookAt).toHaveBeenCalledTimes(1);

    // After disconnect the listener must be gone
    manager.disconnect();
    bus.emit("realtime:gaze", { x: 0, y: 1 });
    expect(renderer.lookAt).toHaveBeenCalledTimes(1); // still 1, not 2

    // disconnect a second time must not throw (idempotent)
    expect(() => manager.disconnect()).not.toThrow();

    // Re-wiring must work: setEventBus again and emit
    manager.setEventBus(bus);
    bus.emit("realtime:gaze", { x: 0.5, y: 0.5 });
    expect(renderer.lookAt).toHaveBeenCalledTimes(2);
  });

  it("suspends mouse tracking briefly after explicit gaze actions", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        right: 100,
        top: 0,
        bottom: 100,
      }),
      configurable: true,
    });

    const manager = createRenderManager(renderer, {
      canvas,
      mouseTracking: "document",
    });
    const bus = new EventBus();

    await manager.initialize();
    manager.setEventBus(bus);

    bus.emit("realtime:gaze", { x: 1, y: 0 });
    document.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 12, clientY: 34 }),
    );
    expect(renderer.updateViewWithMouse).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_200);
    document.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 56, clientY: 78 }),
    );

    expect(renderer.updateViewWithMouse).toHaveBeenCalledWith({
      clientX: 56,
      clientY: 78,
    });
  });
});
