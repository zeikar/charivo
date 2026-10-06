import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IkiModel, IkiParameter } from "@ikijs/format";
import { StandardParameter } from "@ikijs/format";

interface FakeLoadResult {
  failedTextures: number[];
  superseded: boolean;
}

// Instances are pushed here from inside the vi.mock factory so the tests can
// reach into the store the renderer is actually driving.
const playerRegistry = vi.hoisted(() => {
  return {
    instances: [] as Array<{
      store: { get: (id: string) => number };
      pendingAtStart: number;
      load: (model: IkiModel) => Promise<FakeLoadResult>;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    }>,
  };
});

// Only the WebGL player is faked: IkiMotion and ParameterStore are the real
// engine, so these tests double as a contract check against @ikijs/engine.
vi.mock("@ikijs/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ikijs/engine")>();

  class FakePlayer {
    store = new actual.ParameterStore([]);
    // Records how many rAF callbacks were pending at the moment start() was
    // called, so tests can observe that the motion loop was registered first.
    pendingAtStart = -1;
    start = vi.fn(() => {
      this.pendingAtStart = pending.size;
    });
    stop = vi.fn();
    destroy = vi.fn();

    constructor(_canvas: HTMLCanvasElement) {
      playerRegistry.instances.push(this);
    }

    async load(model: IkiModel): Promise<FakeLoadResult> {
      this.store = new actual.ParameterStore(model.parameters);
      return { failedTextures: [], superseded: false };
    }

    getParameter(id: string): number {
      return this.store.get(id);
    }

    setParameter(id: string, value: number): void {
      this.store.set(id, value);
    }
  }

  return { ...actual, IkiPlayer: FakePlayer };
});

import { createIkiRenderer, type IkiRenderer } from "../src/renderer";

const FIXTURE: IkiModel = {
  version: 1,
  name: "fixture",
  canvas: { width: 100, height: 100 },
  parts: [],
  parameters: [
    { id: StandardParameter.MouthOpen, min: 0, max: 1, default: 0 },
    { id: StandardParameter.MouthForm, min: -1, max: 1, default: 0 },
    { id: StandardParameter.EyeOpenLeft, min: 0, max: 1, default: 1 },
    { id: StandardParameter.EyeOpenRight, min: 0, max: 1, default: 1 },
    { id: StandardParameter.EyeballX, min: -1, max: 1, default: 0 },
    { id: StandardParameter.EyeballY, min: -1, max: 1, default: 0 },
    { id: StandardParameter.AngleX, min: -30, max: 30, default: 0 },
    { id: StandardParameter.AngleY, min: -30, max: 30, default: 0 },
    { id: StandardParameter.AngleZ, min: -30, max: 30, default: 0 },
    { id: StandardParameter.Breath, min: 0, max: 1, default: 0 },
    { id: StandardParameter.HairSwayX, min: -20, max: 20, default: 0 },
  ] satisfies IkiParameter[],
  physics: [
    {
      id: "hairSway",
      input: { parameter: StandardParameter.AngleX, weight: 1 },
      output: { parameter: StandardParameter.HairSwayX, scale: -10 },
      mass: 1,
      stiffness: 80,
      damping: 10,
    },
  ],
  // Instant fades, so a play shows at full weight on the next frame.
  expressions: [
    {
      id: "smile",
      description: "Smiling and pleased.",
      fadeIn: 0,
      fadeOut: 0,
      parameters: [{ parameter: StandardParameter.MouthForm, value: 1 }],
    },
    {
      id: "surprised",
      description: "Surprised, mouth dropped open.",
      fadeIn: 0,
      fadeOut: 0,
      parameters: [
        {
          parameter: StandardParameter.MouthOpen,
          value: 0.8,
          blend: "overwrite",
        },
      ],
    },
  ],
  motions: {
    Nod: [
      {
        description: "Nods yes.",
        duration: 1,
        fadeIn: 0,
        fadeOut: 0,
        curves: [
          {
            parameter: StandardParameter.AngleY,
            keys: [
              [0, 0],
              [0.5, -10],
              [1, 0],
            ],
            interpolation: "linear",
          },
        ],
      },
    ],
    Shake: [
      {
        description: "Shakes the head no.",
        duration: 1,
        curves: [{ parameter: StandardParameter.AngleX, keys: [[0, 0]] }],
      },
      {
        description: "Shakes it twice, harder.",
        duration: 1,
        curves: [{ parameter: StandardParameter.AngleX, keys: [[0, 0]] }],
      },
    ],
  },
};

// A model whose `Idle` loop replaces the procedural sway and animates only
// AngleX, so IkiMotion leaves AngleY and the eyeballs unwritten.
const IDLE_FIXTURE: IkiModel = {
  ...FIXTURE,
  physics: undefined,
  expressions: undefined,
  motions: {
    Idle: [
      {
        description: "Sways side to side.",
        duration: 2,
        curves: [
          {
            parameter: StandardParameter.AngleX,
            keys: [
              [0, 0],
              [1, 4],
              [2, 0],
            ],
            interpolation: "linear",
          },
        ],
      },
    ],
  },
};

// ── rAF pump: faithful enough to observe "cancelled" and re-arm behavior ────

let nextRafId = 0;
const pending = new Map<number, FrameRequestCallback>();

function pump(now: number): void {
  const callbacks = Array.from(pending.values());
  pending.clear();
  for (const cb of callbacks) cb(now);
}

/** Pump frames 100 ms apart — IkiMotion's largest step — through `to`. */
function pumpTo(from: number, to: number): void {
  for (let t = from; t <= to; t += 100) pump(t);
}

describe("IkiRenderer / IkiMotion integration", () => {
  let canvas: HTMLCanvasElement;
  let renderer: IkiRenderer;
  let served: IkiModel;

  beforeEach(async () => {
    playerRegistry.instances.length = 0;
    nextRafId = 0;
    pending.clear();
    served = FIXTURE;

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      pending.set(++nextRafId, cb);
      return nextRafId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      pending.delete(id);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            text: async () => JSON.stringify(served),
          }) as Response,
      ),
    );

    canvas = document.createElement("canvas");
    renderer = createIkiRenderer({ canvas });
    await renderer.initialize();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps one rAF loop, motion scheduled first", async () => {
    await renderer.loadModel("/x.iki");

    const player = playerRegistry.instances[0]!;
    expect(pending.size).toBe(1);
    expect(player.start).toHaveBeenCalledTimes(1);
    expect(player.pendingAtStart).toBe(1);

    pump(0);
    expect(pending.size).toBe(1);
  });

  it("honours a gaze stored before load on frame 1, deterministically", async () => {
    expect(() => renderer.lookAt({ x: 0.5, y: 0 })).not.toThrow();
    await renderer.loadModel("/x.iki");

    pump(0);

    const store = playerRegistry.instances[0]!.store;
    expect(store.get(StandardParameter.AngleX)).toBe(13);
    expect(store.get(StandardParameter.EyeballX)).toBe(0.5);
    expect(store.get(StandardParameter.EyeballY)).toBe(0);
    expect(store.get(StandardParameter.MouthOpen)).toBe(0);
  });

  it("head = target + idle sway, eyes = target, over several frames", async () => {
    renderer.lookAt({ x: 0.5, y: 0 });
    await renderer.loadModel("/x.iki");

    const store = playerRegistry.instances[0]!.store;

    for (let t = 0; t <= 96; t += 16) {
      pump(t);
      const angleX = store.get(StandardParameter.AngleX);
      expect(angleX).toBeGreaterThanOrEqual(13 - 3.5);
      expect(angleX).toBeLessThanOrEqual(13 + 3.5);
      expect(store.get(StandardParameter.EyeballX)).toBe(0.5);
    }
    // Deterministic on the idle clock at t <= 96ms: no blink has started yet
    // (the first blink starts >= 1500ms) and breath is still rising (sin > 0
    // for 0 < t < 1750ms).
    expect(store.get(StandardParameter.EyeOpenLeft)).toBe(1);
    expect(store.get(StandardParameter.Breath)).toBeGreaterThan(0.5);

    // IdleMotion clamps dt to 100ms, so 100ms steps advance its clock fully.
    // By t=1500ms idle sway is large enough to tell blended (16.27) apart
    // from a host-wins regression that drops idle's `+ motionValue` (13.00).
    for (let t = 196; t < 1500; t += 100) pump(t);
    pump(1500);
    expect(store.get(StandardParameter.AngleX)).toBeGreaterThan(14);
  });

  it("lets physics read the blended (host-driven) pose", async () => {
    renderer.lookAt({ x: 1, y: 0 });
    await renderer.loadModel("/x.iki");

    const store = playerRegistry.instances[0]!.store;

    pump(0);
    pump(16);
    pump(32);
    pump(48);

    const angleX = store.get(StandardParameter.AngleX);
    expect(angleX).toBeGreaterThanOrEqual(22.5);
    expect(angleX).toBeLessThanOrEqual(29.5);
    // Pins the spring seeded from the host-driven head (26°), not idle's
    // ~0° sway: an unblended seed settles near -0.0024, well short of -8.
    expect(store.get(StandardParameter.HairSwayX)).toBeLessThan(-8);
  });

  it("maps mouse position to gaze", async () => {
    await renderer.loadModel("/x.iki");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    renderer.updateViewWithMouse({ clientX: 400, clientY: 200 });
    pump(0);

    const store = playerRegistry.instances[0]!.store;
    expect(store.get(StandardParameter.AngleX)).toBe(26);
    // -(200 − 200) / 200 is -0, not 0 — mathematically "no vertical offset" either way.
    expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0);
  });

  it("writes lip-sync on the frame, and closes the mouth when disabled", async () => {
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    renderer.setRealtimeLipSync(true);
    renderer.updateRealtimeLipSyncRms(0.5);
    expect(store.get(StandardParameter.MouthOpen)).toBe(0);

    pump(16);
    expect(store.get(StandardParameter.MouthOpen)).toBeCloseTo(0.9);

    renderer.setRealtimeLipSync(false);
    expect(store.get(StandardParameter.MouthOpen)).toBe(0);
    // rms after the disable — RenderManager sends 0 — is ignored.
    renderer.updateRealtimeLipSyncRms(0.5);
    pump(32);
    expect(store.get(StandardParameter.MouthOpen)).toBe(0);
  });

  it("lets lip-sync beat an expression that opens the mouth, then hands it back", async () => {
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    pump(0);
    renderer.playExpression("surprised");
    pump(16);
    expect(store.get(StandardParameter.MouthOpen)).toBe(0.8);

    renderer.setRealtimeLipSync(true);
    renderer.updateRealtimeLipSyncRms(0.1);
    pump(32);
    expect(store.get(StandardParameter.MouthOpen)).toBeCloseTo(0.18);

    renderer.setRealtimeLipSync(false);
    pump(48);
    expect(store.get(StandardParameter.MouthOpen)).toBe(0.8);
  });

  it("is an empty, inert catalog until a model is ready", () => {
    expect(renderer.getAvailableExpressions()).toEqual([]);
    expect(renderer.getAvailableMotionGroups()).toEqual({});
    expect(renderer.getAvatarControlCatalog()).toEqual({
      expressions: [],
      motions: {},
    });
    expect(() => renderer.playExpression("smile")).not.toThrow();
    expect(() => renderer.stopExpression()).not.toThrow();
    expect(() => renderer.playMotionByGroup("Nod", 0)).not.toThrow();
    expect(pending.size).toBe(0);
  });

  it("lists the model's expressions and motions, with their descriptions", async () => {
    await renderer.loadModel("/x.iki");

    expect(renderer.getAvailableExpressions()).toEqual(["smile", "surprised"]);
    expect(renderer.getAvailableMotionGroups()).toEqual({ Nod: 1, Shake: 2 });
    expect(renderer.getAvatarControlCatalog()).toEqual({
      expressions: ["smile", "surprised"],
      motions: { Nod: 1, Shake: 2 },
      expressionDescriptions: {
        smile: "Smiling and pleased.",
        surprised: "Surprised, mouth dropped open.",
      },
      motionDescriptions: {
        Nod: ["Nods yes."],
        Shake: ["Shakes the head no.", "Shakes it twice, harder."],
      },
    });
  });

  it("omits the description maps when the model declares nothing to play", async () => {
    served = { ...FIXTURE, expressions: undefined, motions: undefined };
    await renderer.loadModel("/x.iki");

    expect(renderer.getAvatarControlCatalog()).toEqual({
      expressions: [],
      motions: {},
    });
  });

  it("plays and stops an expression through IkiMotion", async () => {
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    pump(0);
    renderer.playExpression("unknown");
    pump(16);
    expect(store.get(StandardParameter.MouthForm)).toBe(0);

    renderer.playExpression("smile");
    pump(32);
    expect(store.get(StandardParameter.MouthForm)).toBe(1);

    renderer.stopExpression();
    pump(48);
    expect(store.get(StandardParameter.MouthForm)).toBe(0);
  });

  it("adds a nod clip over the gaze on AngleY", async () => {
    renderer.lookAt({ x: 0, y: 0.5 });
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    pump(0);
    renderer.playMotionByGroup("Nod", 0);
    renderer.playMotionByGroup("Nod", 5); // out of range: ignored
    pumpTo(100, 500);

    // Halfway through the clip: its -10° key, on top of the 13° gaze.
    expect(store.get(StandardParameter.AngleY)).toBeCloseTo(26 * 0.5 - 10);
  });

  it("writes the gaze the model's Idle loop leaves unwritten", async () => {
    served = IDLE_FIXTURE;
    renderer.lookAt({ x: 0.5, y: 0.25 });
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    pumpTo(0, 500);

    expect(store.get(StandardParameter.EyeballX)).toBe(0.5);
    expect(store.get(StandardParameter.EyeballY)).toBe(0.25);
    expect(store.get(StandardParameter.AngleY)).toBe(26 * 0.25);
    // AngleX is the Idle clip's (2° at 0.5 s), blended over the gaze.
    expect(store.get(StandardParameter.AngleX)).toBeCloseTo(26 * 0.5 + 2);
  });

  it("destroy stops the loop and frees the player, idempotently", async () => {
    await renderer.loadModel("/x.iki");
    const player = playerRegistry.instances[0]!;

    pump(0);
    pump(16);

    const pendingIdBeforeDestroy = [...pending.keys()][0];
    await renderer.destroy();

    expect(pendingIdBeforeDestroy).toBeDefined();
    expect(pending.size).toBe(0);
    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(renderer.getAvailableExpressions()).toEqual([]);

    pump(999);
    expect(pending.size).toBe(0);

    await expect(renderer.destroy()).resolves.not.toThrow();
  });

  it("does not load when destroyed while the fetch is in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const player = playerRegistry.instances[0]!;
    const loadSpy = vi.spyOn(player, "load");

    const loadPromise = renderer.loadModel("/x.iki");
    await renderer.destroy();
    resolveFetch({
      ok: true,
      text: async () => JSON.stringify(FIXTURE),
    } as Response);
    await loadPromise;

    expect(loadSpy).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it("builds nothing for a superseded load", async () => {
    const player = playerRegistry.instances[0]!;
    vi.spyOn(player, "load").mockResolvedValueOnce({
      failedTextures: [],
      superseded: true,
    });

    await renderer.loadModel("/x.iki");

    expect(pending.size).toBe(0);
    expect(player.start).not.toHaveBeenCalled();
    expect(renderer.getAvailableExpressions()).toEqual([]);
  });

  it("reloads the model without duplicating the rAF loop", async () => {
    const player = playerRegistry.instances[0]!;
    const loadSpy = vi.spyOn(player, "load");

    renderer.lookAt({ x: 0.5, y: 0 });
    await renderer.loadModel("/x.iki");
    await renderer.loadModel("/x.iki");

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(1);

    pump(0);
    // Confirms IkiMotion was rebuilt against the second load's store, not
    // left wired to the first load's (now-discarded) one.
    expect(player.store.get(StandardParameter.AngleX)).toBe(13);
  });
});
