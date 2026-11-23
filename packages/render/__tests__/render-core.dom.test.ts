import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Character,
  type CharivoEventBus,
  type EventMap,
  type GazeCoordinates,
  type Message,
  type MotionPriority,
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

  // Dispatches from a snapshot, as @charivo/core's EventBus does, so a
  // listener that unbinds the manager mid-dispatch still has the manager's
  // own callback for that event follow it.
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    [...(this.listeners[event] ?? [])].forEach((listener) => listener(data));
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
  playMotionByGroup = vi.fn(
    (
      _group: string,
      _index: number,
      _options?: { muteSound?: boolean; priority?: MotionPriority },
    ) => undefined,
  );
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

  it("loadModel hands the path to the renderer, and resolves without loading when the renderer has none", async () => {
    const loadModel = vi.fn(async (_modelPath: string) => undefined);
    const loading = createRenderManager(
      Object.assign(new StubRenderer(), { loadModel }),
    );

    await loading.loadModel("/models/a.model3.json");

    expect(loadModel).toHaveBeenCalledWith("/models/a.model3.json");
    await expect(
      createRenderManager(new StubRenderer()).loadModel(
        "/models/a.model3.json",
      ),
    ).resolves.toBeUndefined();
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

  it("forwards muteSound to the renderer only when the event carries it", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:motion", { group: "TapBody", index: 1, muteSound: true });

    expect(renderer.playMotionByGroup).toHaveBeenCalledWith("TapBody", 1, {
      muteSound: true,
    });
  });

  it("leaves an explicitly audible motion in today's two-argument shape", async () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    // muteSound: false is not the same as asking for muting, and must not be
    // forwarded as an option object either — a renderer that never learned
    // about the flag has to keep seeing exactly what it sees today.
    bus.emit("avatar:motion", { group: "TapBody", index: 1, muteSound: false });

    expect(renderer.playMotionByGroup).toHaveBeenCalledWith("TapBody", 1);
  });

  describe("motion priority", () => {
    function boundManager() {
      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();
      manager.setEventBus(bus);
      return { renderer, bus };
    }

    it("maps reflex to force and ambient to idle", () => {
      const { renderer, bus } = boundManager();

      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 0,
        priority: "reflex",
      });
      bus.emit("avatar:motion", {
        group: "Idle",
        index: 0,
        priority: "ambient",
      });

      expect(renderer.playMotionByGroup.mock.calls).toEqual([
        ["TapBody", 0, { priority: "force" }],
        ["Idle", 0, { priority: "idle" }],
      ]);
    });

    it("forwards both options for a muted reflex motion", () => {
      const { renderer, bus } = boundManager();

      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        muteSound: true,
        priority: "reflex",
      });

      expect(renderer.playMotionByGroup).toHaveBeenCalledWith("TapBody", 1, {
        muteSound: true,
        priority: "force",
      });
    });

    it("keeps the two-argument call for explicit and inferred motions", () => {
      const { renderer, bus } = boundManager();

      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 0,
        priority: "explicit",
      });
      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "inferred",
      });

      expect(renderer.playMotionByGroup.mock.calls).toEqual([
        ["TapBody", 0],
        ["TapBody", 1],
      ]);
    });

    it("forwards an inferred motion right after a reflex one: the renderer decides", () => {
      const { renderer, bus } = boundManager();

      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 0,
        priority: "reflex",
      });
      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "inferred",
      });

      expect(renderer.playMotionByGroup.mock.calls).toEqual([
        ["TapBody", 0, { priority: "force" }],
        ["TapBody", 1],
      ]);
    });

    it("does not debounce a motion the renderer declined", () => {
      const { renderer, bus } = boundManager();
      renderer.playMotionByGroup.mockReturnValueOnce(false as never);

      bus.emit("avatar:motion", { group: "TapBody", index: 1 });
      bus.emit("avatar:motion", { group: "TapBody", index: 1 });

      expect(renderer.playMotionByGroup).toHaveBeenCalledTimes(2);
    });

    it("still debounces a repeated explicit motion inside 1 s", () => {
      const { renderer, bus } = boundManager();

      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "explicit",
      });
      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "explicit",
      });

      expect(renderer.playMotionByGroup).toHaveBeenCalledTimes(1);
    });

    it("debounces an explicit request for a clip a reflex request just named", () => {
      const { renderer, bus } = boundManager();

      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "reflex",
      });
      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "explicit",
      });

      expect(renderer.playMotionByGroup.mock.calls).toEqual([
        ["TapBody", 1, { priority: "force" }],
      ]);
    });

    it("does not debounce an explicit request after an ambient one for the same clip", () => {
      const { renderer, bus } = boundManager();

      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "ambient",
      });
      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "explicit",
      });

      expect(renderer.playMotionByGroup.mock.calls).toEqual([
        ["TapBody", 1, { priority: "idle" }],
        ["TapBody", 1],
      ]);
    });

    it("lets a reflex request through for a clip an explicit request just named", () => {
      const { renderer, bus } = boundManager();

      bus.emit("avatar:motion", { group: "TapBody", index: 1 });
      bus.emit("avatar:motion", {
        group: "TapBody",
        index: 1,
        priority: "reflex",
      });

      expect(renderer.playMotionByGroup.mock.calls).toEqual([
        ["TapBody", 1],
        ["TapBody", 1, { priority: "force" }],
      ]);
    });
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

    // An expression that is still showing is never replayed, however late the
    // repeat; a motion repeats once its debounce window has passed.
    await vi.advanceTimersByTimeAsync(300);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(700);
    bus.emit("avatar:motion", { group: "TapBody", index: 1 });

    expect(renderer.playExpression).toHaveBeenCalledTimes(1);
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

  it("a repeated expression refreshes its hold without replaying it", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(5_000);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    // The first claim's window (due at 8_000) was replaced by the repeat's.
    await vi.advanceTimersByTimeAsync(7_999);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    expect(renderer.playExpression).toHaveBeenCalledTimes(1);
  });

  it("holds the expression past the fallback window while speech is still playing", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    bus.emit("tts:audio:start", {});

    // A long reply. The fallback window is not a ceiling on speech: cutting the
    // face back here would reset it mid-sentence.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("does not arm the fallback for an expression raised mid-utterance", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("still falls back to the hold window when no audio events flow", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    // Text-only config: nothing else would ever drop the face back.
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("re-arms the fallback for an expression raised after speech ended", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});
    // No expression was held, so this end releases nothing.
    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    bus.emit("avatar:expression", { expressionId: "exp_sad" });

    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("ignores re-attaching the same bus mid-utterance", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    bus.emit("tts:audio:start", {});

    // Charivo.attachRenderer() re-attaches an already-attached manager, which
    // must not be read as a rewire: doing so would end the speaking state and
    // cut the expression off mid-sentence.
    manager.setEventBus(bus);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("re-arms the fallback when the bus is replaced mid-utterance", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    bus.emit("tts:audio:start", {});

    // Rewiring preserves the held expression on purpose, but the new bus will
    // never deliver the old utterance's end — so the fallback has to come back
    // or the face stays stuck forever.
    const nextBus = new TestEventBus();
    manager.setEventBus(nextBus);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("re-arms the fallback after detaching mid-utterance", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);
    bus.emit("tts:audio:start", {});

    // The utterance ends while detached, so tts:audio:end is never seen. The
    // speaking state must not survive into the next attachment, or the fallback
    // stays disarmed for good.
    manager.disconnect();

    const nextBus = new TestEventBus();
    manager.setEventBus(nextBus);
    renderer.stopExpression.mockClear();
    nextBus.emit("avatar:expression", { expressionId: "exp_happy" });

    await vi.advanceTimersByTimeAsync(8_000);
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

  it("a renderer without stopExpression keeps its face and never replays it", async () => {
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

    // The claim's release is harmless without stopExpression, and the face it
    // leaves up is still the one showing, so a repeat does not replay it.
    bus.emit("tts:audio:start", {});
    expect(() => bus.emit("tts:audio:end", {})).not.toThrow();
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(8_000);
    bus.emit("avatar:expression", { expressionId: "exp_happy" });

    expect(renderer.playExpression).toHaveBeenCalledTimes(1);
  });

  it("a timed reflex over an inferred claim falls back to it, then to the base face at the end of speech", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});
    bus.emit("avatar:expression", {
      expressionId: "exp_sad",
      source: "avatar-director",
      priority: "inferred",
    });
    bus.emit("avatar:expression", {
      expressionId: "exp_happy",
      source: "game",
      priority: "reflex",
      hold: { ms: 1_500 },
    });
    expect(renderer.playExpression).toHaveBeenLastCalledWith("exp_happy");

    await vi.advanceTimersByTimeAsync(1_499);
    expect(renderer.playExpression).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(renderer.playExpression).toHaveBeenCalledTimes(3);
    expect(renderer.playExpression).toHaveBeenLastCalledWith("exp_sad");
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a timed claim raised in silence outlives an unrelated utterance", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", {
      expressionId: "exp_happy",
      hold: { ms: 3_000 },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    bus.emit("tts:audio:start", {});
    await vi.advanceTimersByTimeAsync(1_000);
    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("an unknown expression id does not displace the same source's live claim", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    await vi.advanceTimersByTimeAsync(5_000);
    bus.emit("avatar:expression", { expressionId: "exp_missing" });

    expect(renderer.playExpression).toHaveBeenCalledTimes(1);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    // The original claim's window still runs from its own start.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
  });

  it("a repeated tts:audio:start is the same utterance: its one end releases the expression", async () => {
    vi.useFakeTimers();

    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);
    const bus = new TestEventBus();

    manager.setEventBus(bus);

    bus.emit("tts:audio:start", {});
    bus.emit("avatar:expression", { expressionId: "exp_happy" });
    bus.emit("tts:audio:start", {});

    await vi.advanceTimersByTimeAsync(30_000);
    expect(renderer.stopExpression).not.toHaveBeenCalled();

    bus.emit("tts:audio:end", {});
    expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("avatar:release and performance spans", () => {
    it("an until-release claim outlives an utterance and is released by avatar:release for its source", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        source: "game",
        hold: "until-release",
      });
      bus.emit("tts:audio:start", {});
      bus.emit("tts:audio:end", {});
      vi.advanceTimersByTime(60_000);
      // Another source, and the other channel, release nothing here.
      bus.emit("avatar:release", { source: "app" });
      bus.emit("avatar:release", { source: "game", channel: "gaze" });
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      bus.emit("avatar:release", { source: "game", channel: "expression" });
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("a claim tied to a performance waits for its start, then holds until its end, not an inner tts:audio:end", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        hold: { performance: "p1" },
      });
      vi.advanceTimersByTime(5_000);
      bus.emit("performance:start", {
        performanceId: "p1",
        origin: "test",
        voiced: true,
      });
      bus.emit("tts:audio:start", {});
      vi.advanceTimersByTime(30_000);
      bus.emit("tts:audio:end", {});
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      bus.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a field-less claim made during a voiced performance is released at its end, not at an inner tts:audio:end", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("performance:start", {
        performanceId: "p1",
        origin: "test",
        voiced: true,
      });
      bus.emit("tts:audio:start", {});
      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      vi.advanceTimersByTime(30_000);
      bus.emit("tts:audio:end", {});
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      bus.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("an unvoiced performance binds no field-less claim", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("performance:start", {
        performanceId: "p1",
        origin: "test",
        voiced: false,
      });
      bus.emit("avatar:expression", { expressionId: "exp_happy" });

      vi.advanceTimersByTime(7_999);
      expect(renderer.stopExpression).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("a claim tied to a performance that has already ended is dropped", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });
      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        hold: { performance: "p1" },
      });

      expect(renderer.playExpression).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("an end dispatched from inside its own start leaves no span for a later claim to bind to", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      // Registered ahead of the manager, so the manager hears the end first.
      bus.on("performance:start", ({ performanceId, origin }) => {
        bus.emit("performance:end", {
          performanceId,
          origin,
          status: "cancelled",
        });
      });
      manager.setEventBus(bus);

      bus.emit("performance:start", {
        performanceId: "p1",
        origin: "test",
        voiced: true,
      });
      bus.emit("avatar:expression", { expressionId: "exp_happy" });

      vi.advanceTimersByTime(8_000);
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("forgets the ids the old bus ended once it moves to another bus", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const busA = new TestEventBus();
      const busB = new TestEventBus();

      manager.setEventBus(busA);
      busA.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });

      manager.setEventBus(busB);
      busB.emit("performance:start", {
        performanceId: "p1",
        origin: "test",
        voiced: true,
      });
      busB.emit("avatar:expression", { expressionId: "exp_happy" });

      vi.advanceTimersByTime(30_000);
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      busB.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    function startPerformance(
      bus: TestEventBus,
      performanceId: string,
      voiced: boolean,
    ): void {
      bus.emit("performance:start", { performanceId, origin: "test", voiced });
    }

    function endPerformance(bus: TestEventBus, performanceId: string): void {
      bus.emit("performance:end", {
        performanceId,
        origin: "test",
        status: "completed",
      });
    }

    it("a late claim for an ended performance leaves the same source's live claim in place", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      endPerformance(bus, "p1");
      startPerformance(bus, "p2", true);
      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        source: "director",
        hold: { performance: "p2" },
      });
      bus.emit("avatar:expression", {
        expressionId: "exp_sad",
        source: "director",
        hold: { performance: "p1" },
      });

      expect(renderer.playExpression.mock.calls).toEqual([["exp_happy"]]);
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      endPerformance(bus, "p2");
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("remembers only the last 32 ended ids, and a repeated end makes an id the newest again", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      for (let i = 0; i < 32; i++) {
        endPerformance(bus, `p${i}`);
      }
      // p0 moves to the newest end, so the next end evicts p1 instead.
      endPerformance(bus, "p0");
      endPerformance(bus, "p32");

      bus.emit("avatar:expression", {
        expressionId: "exp_sad",
        hold: { performance: "p0" },
      });
      expect(renderer.playExpression).not.toHaveBeenCalled();

      startPerformance(bus, "p1", true);
      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      vi.advanceTimersByTime(30_000);
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      endPerformance(bus, "p1");
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("a voiced performance that starts during unreported audio holds a claim made inside it until its own end", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("tts:audio:start", {});
      startPerformance(bus, "p1", true);
      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      bus.emit("tts:audio:end", {});
      vi.advanceTimersByTime(30_000);
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      endPerformance(bus, "p1");
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("a performance restarted as unvoiced no longer stops audio from opening a speech span", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      startPerformance(bus, "p1", true);
      startPerformance(bus, "p1", false);
      bus.emit("tts:audio:start", {});
      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      vi.advanceTimersByTime(30_000);
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      bus.emit("tts:audio:end", {});
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("avatar:release without a channel releases the expression of the source it names", () => {
      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        source: "game",
        hold: "until-release",
      });
      bus.emit("avatar:release", { source: "game" });

      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });

    it("an explicit performance hold follows an unvoiced performance to its end", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        hold: { performance: "p1" },
      });
      startPerformance(bus, "p1", false);
      vi.advanceTimersByTime(30_000);
      expect(renderer.stopExpression).not.toHaveBeenCalled();

      endPerformance(bus, "p1");
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
    });
  });

  describe("a listener ahead of the manager that unbinds it mid-dispatch", () => {
    it("swapping the bus inside performance:end leaves the old bus's end out of the new bus's memory", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const busA = new TestEventBus();
      const busB = new TestEventBus();

      busA.on("performance:end", () => manager.setEventBus(busB));
      manager.setEventBus(busA);

      busA.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });
      busB.emit("performance:start", {
        performanceId: "p1",
        origin: "test",
        voiced: true,
      });
      busB.emit("avatar:expression", { expressionId: "exp_happy" });

      vi.advanceTimersByTime(30_000);
      expect(renderer.stopExpression).not.toHaveBeenCalled();
    });

    it("disconnecting inside avatar:expression leaves no claim behind", () => {
      vi.useFakeTimers();

      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      bus.on("avatar:expression", () => manager.disconnect());
      manager.setEventBus(bus);

      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        hold: "until-release",
      });

      expect(renderer.playExpression).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("disconnecting inside tts:lipsync:update sends no RMS after the detach", () => {
      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      bus.on("tts:lipsync:update", () => manager.disconnect());
      manager.setEventBus(bus);
      bus.emit("tts:audio:start", {});

      bus.emit("tts:lipsync:update", { rms: 0.9 });

      expect(renderer.updateRealtimeLipSyncRms).not.toHaveBeenCalledWith(0.9);
      expect(renderer.updateRealtimeLipSyncRms).toHaveBeenLastCalledWith(0);
    });
  });

  describe("model load", () => {
    function deferred() {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    function loadingRenderer(...loads: Array<Promise<void>>) {
      const queue = [...loads];
      return Object.assign(new StubRenderer(), {
        loadModel: vi.fn((_modelPath: string) => queue.shift()!),
      });
    }

    it("ignores a claim a renderer emits while the load releases the held ones", async () => {
      const load = deferred();
      const renderer = loadingRenderer(load.promise);
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        hold: "until-release",
      });
      renderer.stopExpression.mockImplementation(() => {
        bus.emit("avatar:expression", { expressionId: "exp_sad" });
      });

      const loading = manager.loadModel("/models/b.model3.json");
      load.resolve();
      await loading;

      expect(renderer.playExpression.mock.calls).toEqual([["exp_happy"]]);
    });

    it("does not delegate an older load when a renderer's cleanup starts a newer one", async () => {
      const renderer = loadingRenderer(Promise.resolve());
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        hold: "until-release",
      });
      let newer: Promise<void> | undefined;
      renderer.stopExpression.mockImplementationOnce(() => {
        newer = manager.loadModel("/models/newer.model3.json");
      });

      await manager.loadModel("/models/older.model3.json");
      await newer;

      expect(renderer.loadModel.mock.calls).toEqual([
        ["/models/newer.model3.json"],
      ]);
    });

    it("returns to the lower claim after a renderer's playExpression emitted a higher one", () => {
      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();
      manager.setEventBus(bus);

      renderer.playExpression.mockImplementationOnce(() => {
        bus.emit("avatar:expression", {
          expressionId: "exp_sad",
          source: "e",
          hold: "until-release",
        });
      });
      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        source: "d",
        priority: "inferred",
        hold: "until-release",
      });
      expect(renderer.playExpression.mock.calls).toEqual([
        ["exp_happy"],
        ["exp_sad"],
      ]);

      bus.emit("avatar:release", { source: "e" });
      expect(renderer.playExpression).toHaveBeenLastCalledWith("exp_happy");
    });

    it("forgets the same-motion debounce when the model changes", async () => {
      const renderer = loadingRenderer(Promise.resolve());
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:motion", { group: "TapBody", index: 1 });
      await manager.loadModel("/models/b.model3.json");
      bus.emit("avatar:motion", { group: "TapBody", index: 1 });

      expect(renderer.playMotionByGroup).toHaveBeenCalledTimes(2);
    });

    it("releases a held claim before loading and never shows a claim made while the load is pending", async () => {
      const load = deferred();
      const renderer = loadingRenderer(load.promise);
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:expression", {
        expressionId: "exp_happy",
        hold: "until-release",
      });

      const loading = manager.loadModel("/models/b.model3.json");
      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
      expect(renderer.stopExpression.mock.invocationCallOrder[0]).toBeLessThan(
        renderer.loadModel.mock.invocationCallOrder[0]!,
      );

      bus.emit("avatar:expression", { expressionId: "exp_sad" });
      load.resolve();
      await loading;

      expect(renderer.playExpression.mock.calls).toEqual([["exp_happy"]]);

      bus.emit("avatar:expression", { expressionId: "exp_sad" });
      expect(renderer.playExpression).toHaveBeenLastCalledWith("exp_sad");
    });

    it("a rejected load rejects, releases nothing twice and admits claims again", async () => {
      const load = deferred();
      const renderer = loadingRenderer(load.promise);
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:expression", { expressionId: "exp_happy" });

      const loading = manager.loadModel("/models/missing.model3.json");
      bus.emit("avatar:expression", { expressionId: "exp_sad" });
      load.reject(new Error("fetch failed"));
      await expect(loading).rejects.toThrow("fetch failed");

      expect(renderer.stopExpression).toHaveBeenCalledTimes(1);
      expect(renderer.playExpression.mock.calls).toEqual([["exp_happy"]]);

      bus.emit("avatar:expression", { expressionId: "exp_sad" });
      expect(renderer.playExpression).toHaveBeenLastCalledWith("exp_sad");
    });

    it("never forwards an avatar:motion emitted while the latest load is pending", async () => {
      const load = deferred();
      const renderer = loadingRenderer(load.promise);
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      const loading = manager.loadModel("/models/b.model3.json");
      bus.emit("avatar:motion", { group: "TapBody", index: 1 });
      bus.emit("avatar:motion", {
        group: "Idle",
        index: 0,
        priority: "reflex",
      });
      load.resolve();
      await loading;

      expect(renderer.playMotionByGroup).not.toHaveBeenCalled();

      bus.emit("avatar:motion", { group: "TapBody", index: 1 });
      expect(renderer.playMotionByGroup).toHaveBeenCalledWith("TapBody", 1);
    });

    it("an older load that never settles blocks nothing once the latest resolves", async () => {
      const stuck = deferred();
      const latest = deferred();
      const renderer = loadingRenderer(stuck.promise, latest.promise);
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      void manager.loadModel("/models/a.model3.json");
      const loading = manager.loadModel("/models/b.model3.json");
      latest.resolve();
      await loading;

      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      expect(renderer.playExpression).toHaveBeenCalledWith("exp_happy");
    });

    it("an older load that settles first resumes nothing while the latest is pending", async () => {
      const older = deferred();
      const latest = deferred();
      const renderer = loadingRenderer(older.promise, latest.promise);
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      const first = manager.loadModel("/models/a.model3.json");
      const second = manager.loadModel("/models/b.model3.json");
      older.resolve();
      await first;

      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      expect(renderer.playExpression).not.toHaveBeenCalled();

      latest.resolve();
      await second;
      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      expect(renderer.playExpression).toHaveBeenCalledWith("exp_happy");
    });
  });

  describe("on a renderer without stopExpression", () => {
    class NoReleaseRenderer implements Renderer {
      initialize = vi.fn(async () => undefined);
      destroy = vi.fn(async () => undefined);
      render = vi.fn(
        async (_message: Message, _character?: Character) => undefined,
      );
      playExpression = vi.fn((_expressionId: string) => undefined);
      loadModel = vi.fn(async (_modelPath: string) => undefined);
    }

    it("an expression replaced by another plays again when it comes back", () => {
      const renderer = new NoReleaseRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      bus.emit("avatar:expression", { expressionId: "exp_sad" });
      bus.emit("avatar:expression", { expressionId: "exp_happy" });

      expect(renderer.playExpression.mock.calls).toEqual([
        ["exp_happy"],
        ["exp_sad"],
        ["exp_happy"],
      ]);
    });

    it("an expression shown before a model reload plays again on the new model", async () => {
      const renderer = new NoReleaseRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);

      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      await manager.loadModel("/models/b.model3.json");
      bus.emit("avatar:expression", { expressionId: "exp_happy" });

      expect(renderer.playExpression).toHaveBeenCalledTimes(2);
    });

    it("an older load that installs while the latest is pending counts as a new model when the latest fails", async () => {
      let resolveOlder!: () => void;
      let rejectLatest!: (error: unknown) => void;
      const renderer = new NoReleaseRenderer();
      renderer.loadModel
        .mockImplementationOnce(
          () =>
            new Promise<undefined>(
              (res) => (resolveOlder = () => res(undefined)),
            ),
        )
        .mockImplementationOnce(
          () => new Promise<undefined>((_res, rej) => (rejectLatest = rej)),
        );
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:expression", { expressionId: "exp_happy" });

      const older = manager.loadModel("/models/a.model3.json");
      const latest = manager.loadModel("/models/b.model3.json");
      resolveOlder();
      await older;
      rejectLatest(new Error("fetch failed"));
      await expect(latest).rejects.toThrow("fetch failed");

      bus.emit("avatar:expression", { expressionId: "exp_happy" });
      expect(renderer.playExpression).toHaveBeenCalledTimes(2);
    });
  });

  describe("gaze claims", () => {
    function gazeRenderer() {
      return Object.assign(new StubRenderer(), {
        clearGaze: vi.fn(() => undefined),
      });
    }

    function trackedCanvas() {
      const canvas = document.createElement("canvas");
      Object.defineProperty(canvas, "getBoundingClientRect", {
        value: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
        configurable: true,
      });
      return canvas;
    }

    function moveCursor(clientX: number, clientY: number) {
      document.dispatchEvent(
        new MouseEvent("pointermove", { clientX, clientY }),
      );
    }

    it("hands the renderer only the coordinates of a claim", () => {
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", {
        x: 0.2,
        y: 0.3,
        source: "game",
        priority: "reflex",
        hold: { ms: 500 },
      });

      expect(renderer.lookAt.mock.calls).toStrictEqual([[{ x: 0.2, y: 0.3 }]]);
    });

    it("a repeated gaze claim for the target already showing refreshes its hold and calls no lookAt", () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", { x: 0.2, y: 0.3 });
      vi.advanceTimersByTime(1_000);
      bus.emit("avatar:gaze", { x: 0.2, y: 0.3 });

      expect(renderer.lookAt).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_199);
      expect(renderer.clearGaze).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
    });

    it("a higher claim wins, and when it expires the lower live claim is looked at again without clearGaze", () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", {
        x: 0.9,
        y: 0.9,
        source: "game",
        priority: "reflex",
        hold: { ms: 500 },
      });
      bus.emit("avatar:gaze", {
        x: 0.1,
        y: 0.1,
        source: "avatar-director",
        priority: "inferred",
        hold: "until-release",
      });
      expect(renderer.lookAt.mock.calls).toEqual([[{ x: 0.9, y: 0.9 }]]);

      vi.advanceTimersByTime(500);
      expect(renderer.lookAt.mock.calls).toEqual([
        [{ x: 0.9, y: 0.9 }],
        [{ x: 0.1, y: 0.1 }],
      ]);
      expect(renderer.clearGaze).not.toHaveBeenCalled();
    });

    it("hold { ms: 5000 } keeps cursor tracking suspended for 5 s", async () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer, {
        canvas: trackedCanvas(),
        mouseTracking: "document",
      });
      const bus = new TestEventBus();

      await manager.initialize();
      manager.setEventBus(bus);
      bus.emit("avatar:gaze", { x: 1, y: 0, hold: { ms: 5_000 } });

      await vi.advanceTimersByTimeAsync(4_999);
      moveCursor(12, 34);
      expect(renderer.updateViewWithMouse).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      moveCursor(56, 78);
      expect(renderer.updateViewWithMouse).toHaveBeenCalledWith({
        clientX: 56,
        clientY: 78,
      });
    });

    it("a live gaze claim that is not the winner still blocks local gaze and taps until it ends", async () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer, {
        canvas: trackedCanvas(),
        mouseTracking: "document",
      });
      const bus = new TestEventBus();

      await manager.initialize();
      manager.setEventBus(bus);
      bus.emit("avatar:gaze", {
        x: 0.1,
        y: 0.1,
        source: "avatar-director",
        priority: "inferred",
        hold: { ms: 3_000 },
      });
      bus.emit("avatar:gaze", {
        x: 0.9,
        y: 0.9,
        source: "game",
        priority: "reflex",
        hold: "until-release",
      });
      bus.emit("avatar:release", { source: "game", channel: "gaze" });

      expect(renderer.clearGaze).not.toHaveBeenCalled();
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(false);
      document.dispatchEvent(
        new MouseEvent("pointerdown", { clientX: 20, clientY: 20 }),
      );
      expect(renderer.handleMouseTap).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3_000);
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
      document.dispatchEvent(
        new MouseEvent("pointerdown", { clientX: 40, clientY: 40 }),
      );
      expect(renderer.handleMouseTap).toHaveBeenCalledWith({
        clientX: 40,
        clientY: 40,
      });
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);
    });

    it("setLocalGaze returns false while any gaze claim is live", () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", {
        x: 1,
        y: 0,
        priority: "ambient",
        hold: { ms: 5_000 },
      });

      vi.advanceTimersByTime(3_000);
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(false);

      vi.advanceTimersByTime(2_000);
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);
    });

    it("an until-release gaze claim is ended by avatar:release for the gaze channel, which calls clearGaze once", () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", {
        x: 1,
        y: 0,
        source: "game",
        hold: "until-release",
      });

      vi.advanceTimersByTime(10_000);
      bus.emit("avatar:release", { source: "app", channel: "gaze" });
      bus.emit("avatar:release", { source: "game", channel: "expression" });
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(false);
      expect(renderer.clearGaze).not.toHaveBeenCalled();

      bus.emit("avatar:release", { source: "game", channel: "gaze" });
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);
    });

    it("avatar:release without a channel ends the gaze claim of the source it names", () => {
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", {
        x: 1,
        y: 0,
        source: "game",
        hold: "until-release",
      });
      bus.emit("avatar:release", { source: "game" });

      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);
    });

    it("when the only gaze claim expires, clearGaze is called once", () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", { x: 1, y: 0 });

      vi.advanceTimersByTime(1_199);
      expect(renderer.clearGaze).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10_000);
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
    });

    it("setLocalGaze and cursor moves never call clearGaze", async () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer, {
        canvas: trackedCanvas(),
        mouseTracking: "document",
      });

      await manager.initialize();
      expect(manager.setLocalGaze({ x: 0.3, y: 0.3 })).toBe(true);
      await vi.advanceTimersByTimeAsync(700);
      moveCursor(10, 10);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(renderer.updateViewWithMouse).toHaveBeenCalled();
      expect(renderer.clearGaze).not.toHaveBeenCalled();
    });

    it("a renderer without clearGaze does not throw when a gaze claim ends", () => {
      vi.useFakeTimers();
      const renderer = new StubRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", { x: 1, y: 0 });
      expect(() => vi.advanceTimersByTime(1_200)).not.toThrow();

      bus.emit("avatar:gaze", { x: 0, y: 1, hold: "until-release" });
      expect(() => bus.emit("avatar:release", { source: "app" })).not.toThrow();
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);
    });

    it("a gaze claim tied to a performance holds until its end", () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("performance:start", {
        performanceId: "p1",
        origin: "test",
        voiced: true,
      });
      bus.emit("avatar:gaze", { x: 1, y: 0, hold: { performance: "p1" } });

      vi.advanceTimersByTime(10_000);
      expect(renderer.clearGaze).not.toHaveBeenCalled();

      bus.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
    });

    it("a gaze claim tied to a performance that has already ended is dropped", () => {
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });
      bus.emit("avatar:gaze", { x: 1, y: 0, hold: { performance: "p1" } });

      expect(renderer.lookAt).not.toHaveBeenCalled();
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);
    });

    it("a late gaze claim for an ended performance leaves the same source's live claim in place", () => {
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", {
        x: 0.2,
        y: 0.3,
        source: "game",
        hold: "until-release",
      });
      bus.emit("performance:end", {
        performanceId: "p1",
        origin: "test",
        status: "completed",
      });
      bus.emit("avatar:gaze", {
        x: 1,
        y: 0,
        source: "game",
        hold: { performance: "p1" },
      });

      expect(renderer.lookAt.mock.calls).toEqual([[{ x: 0.2, y: 0.3 }]]);
      bus.emit("avatar:release", { source: "game", channel: "gaze" });
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
    });

    it("a gaze claim bound to a performance falls back to the pre-speech window when the bus is replaced", () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("performance:start", {
        performanceId: "p1",
        origin: "test",
        voiced: true,
      });
      bus.emit("avatar:gaze", { x: 1, y: 0, hold: { performance: "p1" } });
      manager.setEventBus(new TestEventBus());

      vi.advanceTimersByTime(7_999);
      expect(renderer.clearGaze).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
    });

    it("ignores a gaze claim with a non-finite target and keeps the source's live claim", () => {
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", { x: 1, y: 0, hold: "until-release" });
      bus.emit("avatar:gaze", {
        x: Number.NaN,
        y: 0,
        priority: "reflex",
        hold: "until-release",
      });
      bus.emit("avatar:gaze", { x: 0, y: Number.POSITIVE_INFINITY });

      expect(renderer.lookAt).toHaveBeenCalledTimes(1);
      expect(renderer.clearGaze).not.toHaveBeenCalled();
      bus.emit("avatar:release", { source: "app" });
      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
    });

    it("disconnect() ends a held gaze claim at once and leaves no timer", () => {
      vi.useFakeTimers();
      const renderer = gazeRenderer();
      const manager = createRenderManager(renderer);
      const bus = new TestEventBus();

      manager.setEventBus(bus);
      bus.emit("avatar:gaze", { x: 1, y: 0 });
      manager.disconnect();

      expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);
    });

    describe("model load", () => {
      function loadingGazeRenderer() {
        let resolve!: () => void;
        const loadModel = vi.fn(
          (_modelPath: string) =>
            new Promise<void>((res) => {
              resolve = res;
            }),
        );
        const renderer = Object.assign(gazeRenderer(), { loadModel });
        return { renderer, resolve: () => resolve() };
      }

      it("releases an until-release gaze claim through clearGaze before loading, freeing cursor and local gaze at once", async () => {
        const { renderer, resolve } = loadingGazeRenderer();
        const manager = createRenderManager(renderer, {
          canvas: trackedCanvas(),
          mouseTracking: "document",
        });
        const bus = new TestEventBus();

        await manager.initialize();
        manager.setEventBus(bus);
        bus.emit("avatar:gaze", { x: 1, y: 0, hold: "until-release" });

        const loading = manager.loadModel("/models/b.model3.json");
        expect(renderer.clearGaze).toHaveBeenCalledTimes(1);
        expect(renderer.clearGaze.mock.invocationCallOrder[0]).toBeLessThan(
          renderer.loadModel.mock.invocationCallOrder[0]!,
        );

        moveCursor(56, 78);
        expect(renderer.updateViewWithMouse).toHaveBeenCalledWith({
          clientX: 56,
          clientY: 78,
        });
        expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);

        resolve();
        await loading;
      });

      it("a load with no live gaze claim calls no clearGaze", async () => {
        const { renderer, resolve } = loadingGazeRenderer();
        const manager = createRenderManager(renderer);

        const loading = manager.loadModel("/models/b.model3.json");
        resolve();
        await loading;

        expect(renderer.clearGaze).not.toHaveBeenCalled();
      });

      it("an avatar:gaze emitted while the latest load is pending calls no lookAt and suspends nothing", async () => {
        const { renderer, resolve } = loadingGazeRenderer();
        const manager = createRenderManager(renderer, {
          canvas: trackedCanvas(),
          mouseTracking: "document",
        });
        const bus = new TestEventBus();

        await manager.initialize();
        manager.setEventBus(bus);

        const loading = manager.loadModel("/models/b.model3.json");
        bus.emit("avatar:gaze", { x: 1, y: 0, hold: "until-release" });

        expect(renderer.lookAt).not.toHaveBeenCalled();
        moveCursor(56, 78);
        expect(renderer.updateViewWithMouse).toHaveBeenCalledWith({
          clientX: 56,
          clientY: 78,
        });

        resolve();
        await loading;
        expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(true);
      });
    });
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
    expect(manager.setLocalGaze(coords)).toBe(true);
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

    expect(manager.setLocalGaze({ x: 0.1, y: 0.1 })).toBe(false);

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
    expect(manager.setLocalGaze({ x: 0.5, y: 0.5 })).toBe(false);
    expect(renderer.lookAt).not.toHaveBeenCalled();
  });

  it("setLocalGaze does not yield to its own local-gaze window", () => {
    const renderer = new StubRenderer();
    const manager = createRenderManager(renderer);

    // Two back-to-back applies (no AI window): both must apply.
    expect(manager.setLocalGaze({ x: 0.1, y: 0.1 })).toBe(true);
    expect(manager.setLocalGaze({ x: 0.2, y: 0.2 })).toBe(true);
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
    expect(manager.setLocalGaze({ x: 0.3, y: 0.3 })).toBe(true);

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
