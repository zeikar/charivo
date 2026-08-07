import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventBus,
  type Character,
  type GazeCoordinates,
  type Message,
  type Renderer,
} from "@charivo/core";
import { createRenderManager } from "../src";

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
  beforeEach(() => {
    vi.useRealTimers();
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
    manager.setMessageCallback!(callback);

    await manager.initialize();
    await manager.render(message);
    await manager.destroy();

    expect(renderer.initialize).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith(message, character);
    expect(callback).toHaveBeenCalledWith(message, character);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it("forwards TTS and canonical realtime events through the typed event bus", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new EventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});
    bus.emit("tts:lipsync:update", { rms: 0.42 });
    bus.emit("tts:audio:end", {});
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    bus.emit("avatar:motion", { group: "TapBody", index: 1 });
    bus.emit("avatar:gaze", { x: 0.25, y: -0.5 });

    expect(renderer.setRealtimeLipSync).toHaveBeenNthCalledWith(1, true);
    expect(renderer.updateRealtimeLipSyncRms).toHaveBeenCalledWith(0.42);
    expect(renderer.setRealtimeLipSync).toHaveBeenNthCalledWith(2, false);
    expect(renderer.updateRealtimeLipSyncRms).toHaveBeenLastCalledWith(0);
    expect(renderer.playExpression).toHaveBeenCalledWith("exp_happy");
    expect(renderer.playMotionByGroup).toHaveBeenCalledWith("TapBody", 1);
    expect(renderer.lookAt).toHaveBeenCalledWith({ x: 0.25, y: -0.5 });
  });

  it("debounces repeated explicit expression and motion actions", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new EventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    bus.emit("avatar:motion", { group: "TapBody", index: 1 });
    bus.emit("avatar:motion", { group: "TapBody", index: 1 });

    expect(renderer.playExpression).toHaveBeenCalledTimes(1);
    expect(renderer.playMotionByGroup).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(700);
    bus.emit("avatar:motion", { group: "TapBody", index: 1 });

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
    bus.emit("avatar:gaze", { x: 1, y: 0 });
    expect(renderer.lookAt).toHaveBeenCalledTimes(1);

    // After disconnect the listener must be gone
    manager.disconnect();
    bus.emit("avatar:gaze", { x: 0, y: 1 });
    expect(renderer.lookAt).toHaveBeenCalledTimes(1); // still 1, not 2

    // disconnect a second time must not throw (idempotent)
    expect(() => manager.disconnect()).not.toThrow();

    // Re-wiring must work: setEventBus again and emit
    manager.setEventBus(bus);
    bus.emit("avatar:gaze", { x: 0.5, y: 0.5 });
    expect(renderer.lookAt).toHaveBeenCalledTimes(2);
  });

  it("disconnect stops an in-progress realtime lip-sync so the renderer gets no more RMS updates", () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new EventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});

    // Lip-sync is now active: renderer should have been told true
    expect(renderer.setRealtimeLipSync).toHaveBeenCalledWith(true);

    renderer.setRealtimeLipSync.mockClear();
    renderer.updateRealtimeLipSyncRms.mockClear();

    manager.disconnect();

    // lip-sync must be deactivated: renderer told false and mouth forced closed
    expect(renderer.setRealtimeLipSync).toHaveBeenCalledWith(false);
    expect(renderer.updateRealtimeLipSyncRms).toHaveBeenCalledWith(0);

    // Any subsequent RMS updates (stale callbacks) must not reach the renderer
    renderer.updateRealtimeLipSyncRms.mockClear();
    bus.emit("tts:lipsync:update", { rms: 0.9 });
    expect(renderer.updateRealtimeLipSyncRms).not.toHaveBeenCalled();
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

    bus.emit("avatar:gaze", { x: 1, y: 0 });
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

  it("setLocalGaze applies, looks at the coords, and suspends mouse cursor tracking", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
      configurable: true,
    });

    const manager = createRenderManager(renderer, {
      canvas,
      mouseTracking: "document",
    });

    await manager.initialize();

    const coords: GazeCoordinates = { x: 0.3, y: -0.2 };
    expect(manager.setLocalGaze!(coords)).toBe(true);
    expect(renderer.lookAt).toHaveBeenCalledWith(coords);

    // Local-gaze window suppresses the mouse cursor target right after.
    document.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 12, clientY: 34 }),
    );
    expect(renderer.updateViewWithMouse).not.toHaveBeenCalled();

    // After the local-gaze window elapses, the cursor target resumes.
    await vi.advanceTimersByTimeAsync(700);
    document.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 56, clientY: 78 }),
    );
    expect(renderer.updateViewWithMouse).toHaveBeenCalledWith({
      clientX: 56,
      clientY: 78,
    });
  });

  it("setLocalGaze no-ops on a renderer without lookAt and does not open the local-gaze window", async () => {
    class NoGazeRenderer implements Renderer {
      initialize = vi.fn(async () => undefined);
      destroy = vi.fn(async () => undefined);
      render = vi.fn(
        async (_message: Message, _character?: Character) => undefined,
      );
      updateViewWithMouse = vi.fn(
        (_coords: { clientX: number; clientY: number }) => undefined,
      );
      handleMouseTap = vi.fn(
        (_coords: { clientX: number; clientY: number }) => undefined,
      );
    }

    const renderer = new NoGazeRenderer();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
      configurable: true,
    });

    const manager = createRenderManager(renderer, {
      canvas,
      mouseTracking: "document",
    });

    await manager.initialize();

    expect(manager.setLocalGaze!({ x: 0.1, y: 0.1 })).toBe(false);

    // No local-gaze window means the cursor target still runs.
    document.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 9, clientY: 9 }),
    );
    expect(renderer.updateViewWithMouse).toHaveBeenCalledWith({
      clientX: 9,
      clientY: 9,
    });
  });

  it("setLocalGaze yields to an active AI gaze window", () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new EventBus();

    manager.setEventBus(bus);

    // Open the AI gaze window.
    bus.emit("avatar:gaze", { x: 1, y: 0 });
    expect(renderer.lookAt).toHaveBeenCalledTimes(1);
    renderer.lookAt.mockClear();

    // Within the 1200ms AI window, local gaze yields.
    expect(manager.setLocalGaze!({ x: 0.5, y: 0.5 })).toBe(false);
    expect(renderer.lookAt).not.toHaveBeenCalled();
  });

  it("setLocalGaze does not yield to its own local-gaze window", () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);

    // Two back-to-back applies (no AI window): both must apply.
    expect(manager.setLocalGaze!({ x: 0.1, y: 0.1 })).toBe(true);
    expect(manager.setLocalGaze!({ x: 0.2, y: 0.2 })).toBe(true);
    expect(renderer.lookAt).toHaveBeenCalledTimes(2);
  });

  it("taps survive a webcam local-gaze window but yield to the AI gaze window; cursor yields to webcam", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
      configurable: true,
    });

    const manager = createRenderManager(renderer, {
      canvas,
      mouseTracking: "document",
    });
    const bus = new EventBus();

    await manager.initialize();
    manager.setEventBus(bus);

    // Open a local-gaze window (no AI window).
    expect(manager.setLocalGaze!({ x: 0.3, y: 0.3 })).toBe(true);

    // A tap still fires while webcam gaze is active.
    document.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 20, clientY: 20 }),
    );
    expect(renderer.handleMouseTap).toHaveBeenCalledWith({
      clientX: 20,
      clientY: 20,
    });

    // The cursor target is suppressed by the local-gaze window.
    document.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 30, clientY: 30 }),
    );
    expect(renderer.updateViewWithMouse).not.toHaveBeenCalled();

    renderer.handleMouseTap.mockClear();

    // Open the AI gaze window: now taps yield too.
    bus.emit("avatar:gaze", { x: 1, y: 0 });
    document.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 40, clientY: 40 }),
    );
    expect(renderer.handleMouseTap).not.toHaveBeenCalled();
  });
});
