import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Character,
  type CharivoEventBus,
  type EventMap,
  type GazeCoordinates,
  type Message,
  type Renderer,
} from "@charivo/core";
import { createRenderManager } from "../src";

// Minimal CharivoEventBus double: exercises RenderManager's on/off/emit
// wiring without reaching into @charivo/core's internal EventBus class.
class TestEventBus implements CharivoEventBus {
  private listeners: {
    [K in keyof EventMap]?: Array<(data: EventMap[K]) => void>;
  } = {};

  on<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void {
    this.listeners[event] ??= [];
    this.listeners[event]!.push(listener);
  }

  off<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void {
    const eventListeners = this.listeners[event];
    if (!eventListeners) {
      return;
    }

    const index = eventListeners.indexOf(listener);
    if (index > -1) {
      eventListeners.splice(index, 1);
    }
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.listeners[event]?.forEach((listener) => listener(data));
  }
}

class StubRenderer implements Renderer {
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  render = vi.fn(
    async (_message: Message, _character?: Character) => undefined,
  );
  playExpression = vi.fn((_expressionId: string) => undefined);
  stopExpression = vi.fn(() => undefined);
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
    const bus = new TestEventBus();

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
    const bus = new TestEventBus();

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

  it("releases the expression after the hold window", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    await vi.advanceTimersByTimeAsync(7_999);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("a new expression restarts the hold window instead of stacking with the previous one", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(5_000);
    bus.emit("avatar:expression", { expressionId: "exp_sad" });

    // If the first timer (due at 8_000) were not cancelled, it would fire here.
    await vi.advanceTimersByTimeAsync(7_999);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("a debounced duplicate expression does not restart the hold window", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(200);
    // Swallowed by the 300ms debounce window: must not reschedule the release.
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    await vi.advanceTimersByTimeAsync(7_800);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("releases a held expression when tts:audio:end arrives before the 8s cap", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    bus.emit("tts:audio:start", {});
    await vi.advanceTimersByTimeAsync(2_000);
    bus.emit("tts:audio:end", {});

    // The utterance the expression accompanied is over: release now, well
    // before the 8s cap would have fired.
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);

    // The cap must have been cancelled, not merely beaten.
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);

    // The hold state is cleared, so a second audio end releases nothing.
    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);

    // The cap re-arms for the next expression.
    bus.emit("avatar:expression", { expressionId: "exp_sad" });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(2);
  });

  it("releases an expression applied mid-audio at the utterance end", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});
    await vi.advanceTimersByTimeAsync(1_000);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(2_000);
    bus.emit("tts:audio:end", {});

    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("an expression applied after audio ended falls back to the 8s cap", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});
    bus.emit("tts:audio:end", {});
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    // A past audio end must not release an expression applied afterwards.
    await vi.advanceTimersByTimeAsync(7_999);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("tts:audio:end with no held expression never calls stopExpression", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});
    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);

    // Already released by the cap: a later audio end must not release again.
    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("disconnect() releases a pending expression synchronously instead of leaving it to the timer", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    manager.disconnect();

    // Released immediately: the manager is relinquishing the renderer, so a
    // timer must not outlive that ownership (it may since have been handed
    // to a different manager).
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // No second release when the old hold window would have elapsed.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("a pending expression release still fires after a setEventBus() rewire", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    // setEventBus() internally disconnects before reconnecting; the pending
    // release must survive that rewire rather than being silently abandoned.
    manager.setEventBus(bus);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("destroy() disconnects first, releasing any held expression before the renderer is torn down", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await manager.destroy();

    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // No leftover timer fires a second release later.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("detaching after an expression, then reattaching the same manager, starts clean (no leftover expression or stray timer)", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    manager.disconnect();
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // Advancing past the original hold window must not trigger a second
    // release from stale state.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);

    // Reattaching the SAME manager instance is the documented reusable
    // render-manager lifecycle (packages/core/README.md): a fresh
    // expression must schedule a fresh hold, not be swallowed by stale
    // state left over from before the detach.
    manager.setEventBus(bus);
    bus.emit("avatar:expression", { expressionId: "exp_sad" });
    expect(renderer.playExpression).toHaveBeenLastCalledWith("exp_sad");

    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(2);
  });

  it("a renderer without stopExpression schedules no release timer and ignores tts:audio:end", () => {
    vi.useFakeTimers();

    class ExpressionOnlyRenderer implements Renderer {
      initialize = vi.fn(async () => undefined);
      destroy = vi.fn(async () => undefined);
      render = vi.fn(
        async (_message: Message, _character?: Character) => undefined,
      );
      playExpression = vi.fn((_expressionId: string) => undefined);
      updateViewWithMouse = vi.fn(
        (_coords: { clientX: number; clientY: number }) => undefined,
      );
      handleMouseTap = vi.fn(
        (_coords: { clientX: number; clientY: number }) => undefined,
      );
    }

    const renderer = new ExpressionOnlyRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    expect(vi.getTimerCount()).toBe(0);

    // The audio-end release path is inert here too: without stopExpression the
    // manager must keep its debounce state, so a duplicate still inside the
    // 300ms window stays swallowed instead of replaying.
    bus.emit("tts:audio:end", {});
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    expect(renderer.playExpression).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
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
    const bus = new TestEventBus();

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
    const bus = new TestEventBus();

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
    const bus = new TestEventBus();

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
    const bus = new TestEventBus();

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
    const bus = new TestEventBus();

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
