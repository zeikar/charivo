import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotionPriority } from "@charivo/core";
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
      setView: ReturnType<typeof vi.fn>;
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
    setView = vi.fn();
    destroy = vi.fn();

    constructor(_canvas: HTMLCanvasElement) {
      playerRegistry.instances.push(this);
    }

    // The engine's `cancelLoad` settles a pending load as superseded and
    // adopts nothing; with none pending it does nothing.
    private pendingLoad?: { cancelled: boolean };

    async load(model: IkiModel): Promise<FakeLoadResult> {
      const load = { cancelled: false };
      this.pendingLoad = load;
      await Promise.resolve();
      if (this.pendingLoad === load) this.pendingLoad = undefined;
      if (load.cancelled) return { failedTextures: [], superseded: true };
      this.store = new actual.ParameterStore(model.parameters);
      return { failedTextures: [], superseded: false };
    }

    cancelLoad = vi.fn(() => {
      if (this.pendingLoad) {
        this.pendingLoad.cancelled = true;
        this.pendingLoad = undefined;
      }
    });

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

// The suite drives the factory's own return type, so a member dropped from
// `IkiRenderer` fails the typecheck here. Only the two members it leaves
// optional, as `Renderer` declares them, are asserted present.
type LoadedIkiRenderer = IkiRenderer &
  Required<
    Pick<IkiRenderer, "setRealtimeLipSync" | "updateRealtimeLipSyncRms">
  >;

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
        // Instant and held at 15°, so the frame after a play shows whether
        // this clip took the head.
        fadeIn: 0,
        fadeOut: 0,
        curves: [{ parameter: StandardParameter.AngleX, keys: [[0, 15]] }],
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

describe("package entry", () => {
  it("exports the factory and no class", async () => {
    const entry = await import("../src/renderer");
    expect(Object.keys(entry)).toEqual(["createIkiRenderer"]);
  });
});

describe("IkiRenderer / IkiMotion integration", () => {
  let canvas: HTMLCanvasElement;
  let renderer: LoadedIkiRenderer;
  let served: IkiModel;

  beforeEach(async () => {
    playerRegistry.instances.length = 0;
    nextRafId = 0;
    pending.clear();
    served = FIXTURE;

    // The engine's idle draws from Math.random. Pinned at 0.5, every gaze it
    // picks for itself is the centre (0, 0), so an eye or a head turn seen
    // below can only be the host's.
    vi.spyOn(Math, "random").mockReturnValue(0.5);

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
    renderer = createIkiRenderer({ canvas }) as LoadedIkiRenderer;
    await renderer.initialize();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it("leaves the head and eyes to the engine's idle until a gaze arrives", async () => {
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    pumpTo(0, 1000);

    expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(0, 2);
    // Only the idle's drift, still fading in: well short of a gaze's follow.
    expect(Math.abs(store.get(StandardParameter.AngleX))).toBeLessThan(2);
  });

  it("hands a gaze stored before load to the engine: the eyes go there, the head follows", async () => {
    expect(() => renderer.lookAt({ x: 0.5, y: -0.25 })).not.toThrow();
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    // Springs, not a write: nothing has moved on the first frame.
    pump(0);
    expect(store.get(StandardParameter.EyeballX)).toBe(0);

    pumpTo(100, 1000);

    expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(0.5, 2);
    expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(-0.25, 2);
    // The engine's follow is 10° per unit of gaze, plus its drift (under 1°
    // this early). The adapter's old 26° per unit would read 13 here.
    const angleX = store.get(StandardParameter.AngleX);
    expect(angleX).toBeGreaterThan(3.5);
    expect(angleX).toBeLessThan(6.5);
    expect(store.get(StandardParameter.AngleY)).toBeLessThan(-1);
  });

  it("moves a held gaze when the host sends another", async () => {
    renderer.lookAt({ x: 1, y: 0 });
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;
    pumpTo(0, 1000);
    expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(1, 2);

    renderer.lookAt({ x: -1, y: 0 });
    pumpTo(1100, 2000);

    expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(-1, 2);
    expect(store.get(StandardParameter.AngleX)).toBeLessThan(-5);
  });

  it("lets physics read the head a gaze turned", async () => {
    renderer.lookAt({ x: 1, y: 0 });
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    pumpTo(0, 1000);

    // The fixture's rig reads AngleX at scale -10: the head's turn after the
    // gaze swings it to about -3, where the idle's drift alone leaves it
    // within 0.2 of rest.
    expect(store.get(StandardParameter.HairSwayX)).toBeLessThan(-1);
  });

  // The engine clamps and drops a non-finite pair itself; on a model whose
  // eyes range past ±1, where the store would let 2 through, these show it
  // under an `Idle` group, where the engine moves the eyes by a spring.
  describe("under an Idle group whose eyes range to ±2", () => {
    beforeEach(() => {
      served = {
        ...IDLE_FIXTURE,
        parameters: IDLE_FIXTURE.parameters.map((parameter) =>
          parameter.id === StandardParameter.EyeballX
            ? { ...parameter, min: -2, max: 2 }
            : parameter,
        ),
      };
    });

    it("clamps a gaze to -1..1", async () => {
      renderer.lookAt({ x: 5, y: 0 });
      await renderer.loadModel("/x.iki");

      pumpTo(0, 2000);

      const store = playerRegistry.instances[0]!.store;
      expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(1, 2);
    });

    it("keeps the last gaze when a non-finite one arrives", async () => {
      renderer.lookAt({ x: 0.5, y: 0 });
      renderer.lookAt({ x: Number.NaN, y: 0 });
      await renderer.loadModel("/x.iki");

      pumpTo(0, 2000);

      const store = playerRegistry.instances[0]!.store;
      expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(0.5, 2);
    });
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

    // Right edge, a quarter of the way down from the top: x = 1, y = 0.5.
    renderer.updateViewWithMouse({ clientX: 400, clientY: 100 });
    pumpTo(0, 1000);

    const store = playerRegistry.instances[0]!.store;
    expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(1, 2);
    expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0.5, 2);
  });

  describe("setGazeOrigin", () => {
    // The fixture is 100 model units square. In the 400 px canvas below it
    // draws at 4 px a unit, so the point a quarter of the way down it, 25
    // units above its centre, is 100 px above the canvas's: client y 100.
    beforeEach(() => {
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
    });

    it("measures the mouse from a point of the model, not the canvas centre", async () => {
      await renderer.loadModel("/x.iki");
      renderer.setGazeOrigin({ x: 0.5, y: 0.25 });

      // Level with the origin at the right edge: without it this reads 0.5 up.
      renderer.updateViewWithMouse({ clientX: 400, clientY: 100 });
      pumpTo(0, 1000);

      const store = playerRegistry.instances[0]!.store;
      expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(1, 2);
      expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0, 2);
    });

    it("finds the point through the view the model is framed in", async () => {
      // Twice as wide as the model: it now draws at 2 px a unit, so the same
      // point is 50 px above the canvas's centre, client y 150.
      renderer.setView({ x: 0, y: 0, width: 200, height: 100 });
      renderer.setGazeOrigin({ x: 0.5, y: 0.25 });
      await renderer.loadModel("/x.iki");

      renderer.updateViewWithMouse({ clientX: 400, clientY: 150 });
      pumpTo(0, 1000);

      const store = playerRegistry.instances[0]!.store;
      expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0, 2);
    });

    it("follows the view's centre, and the origin's x", async () => {
      // The view's centre is 50 units right of the model's, and the origin,
      // four fifths of the way across the model, 30: 20 units left of the
      // view's centre, 80 px left of the canvas's, client x 120.
      renderer.setView({ x: 50, y: 0, width: 100, height: 100 });
      renderer.setGazeOrigin({ x: 0.8, y: 0.5 });
      await renderer.loadModel("/x.iki");

      renderer.updateViewWithMouse({ clientX: 220, clientY: 200 });
      pumpTo(0, 1000);

      const store = playerRegistry.instances[0]!.store;
      expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(0.5, 2);
    });

    it("goes back to the canvas centre with no argument", async () => {
      await renderer.loadModel("/x.iki");
      renderer.setGazeOrigin({ x: 0.5, y: 0.25 });
      renderer.setGazeOrigin();

      renderer.updateViewWithMouse({ clientX: 400, clientY: 100 });
      pumpTo(0, 1000);

      const store = playerRegistry.instances[0]!.store;
      expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0.5, 2);
    });

    it("refuses a non-finite point, and keeps the one it had", async () => {
      await renderer.loadModel("/x.iki");
      renderer.setGazeOrigin({ x: 0.5, y: 0.25 });

      expect(() => renderer.setGazeOrigin({ x: 0.5, y: Number.NaN })).toThrow(
        "finite x and y",
      );
      expect(() =>
        renderer.setGazeOrigin({ x: 0.5 } as { x: number; y: number }),
      ).toThrow("finite x and y");

      renderer.updateViewWithMouse({ clientX: 400, clientY: 100 });
      pumpTo(0, 1000);

      const store = playerRegistry.instances[0]!.store;
      expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0, 2);
    });

    it("leaves lookAt alone: that is already a direction", async () => {
      await renderer.loadModel("/x.iki");
      renderer.setGazeOrigin({ x: 0.5, y: 0.25 });

      renderer.lookAt({ x: 0, y: 0.5 });
      pumpTo(0, 1000);

      const store = playerRegistry.instances[0]!.store;
      expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0.5, 2);
    });
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

  it("plays a nod over the gaze: the clip takes the head, the eyes stay", async () => {
    renderer.lookAt({ x: 0, y: 0.5 });
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    pump(0);
    renderer.playMotionByGroup("Nod", 0);
    renderer.playMotionByGroup("Nod", 5); // out of range: ignored
    pumpTo(100, 500);

    // Halfway through the clip, its -10° key: a clip replaces the idle's head,
    // gaze follow included, for as long as it runs.
    expect(store.get(StandardParameter.AngleY)).toBeCloseTo(-10);
    expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0.5, 2);
  });

  describe("motion priority against the running clip", () => {
    // Nod runs 0..1 s and drives AngleY (-10° at 0.5 s, -8° at 0.6 s); Shake
    // clip 0 holds AngleX at 15° from its first frame. Each case starts Nod
    // at t = 0 and asks for Shake halfway through it.
    async function nodThenShake(
      nod: MotionPriority | undefined,
      shake: MotionPriority | undefined,
    ) {
      await renderer.loadModel("/x.iki");
      const store = playerRegistry.instances[0]!.store;
      pump(0);
      renderer.playMotionByGroup("Nod", 0, nod && { priority: nod });
      pumpTo(100, 500);
      renderer.playMotionByGroup("Shake", 0, shake && { priority: shake });
      pump(600);
      return store;
    }

    it("leaves a normal clip running under an idle request, which plays once it is over", async () => {
      const store = await nodThenShake(undefined, "idle");

      expect(store.get(StandardParameter.AngleY)).toBeCloseTo(-8);
      expect(store.get(StandardParameter.AngleX)).toBeLessThan(1);

      pumpTo(700, 1100);
      renderer.playMotionByGroup("Shake", 0, { priority: "idle" });
      pump(1200);

      expect(store.get(StandardParameter.AngleX)).toBeCloseTo(15);
    });

    it("declines a normal request while a force clip runs", async () => {
      const store = await nodThenShake("force", "normal");

      expect(store.get(StandardParameter.AngleY)).toBeCloseTo(-8);
      expect(store.get(StandardParameter.AngleX)).toBeLessThan(1);
    });

    it("lets a force request cut a normal clip", async () => {
      const store = await nodThenShake("normal", "force");

      expect(store.get(StandardParameter.AngleX)).toBeCloseTo(15);
    });

    it("still lets a normal request replace a normal clip", async () => {
      const store = await nodThenShake(undefined, undefined);

      expect(store.get(StandardParameter.AngleX)).toBeCloseTo(15);
    });

    it("does not count a request for a clip the model lacks as running", async () => {
      await renderer.loadModel("/x.iki");
      const store = playerRegistry.instances[0]!.store;
      pump(0);

      renderer.playMotionByGroup("Missing", 0, { priority: "force" });
      renderer.playMotionByGroup("Shake", 0, { priority: "idle" });
      pump(100);

      expect(store.get(StandardParameter.AngleX)).toBeCloseTo(15);
    });

    it("keeps the running clip's priority when a request for a missing clip is rejected", async () => {
      await renderer.loadModel("/x.iki");
      const store = playerRegistry.instances[0]!.store;
      pump(0);
      renderer.playMotionByGroup("Nod", 0, { priority: "force" });
      pumpTo(100, 500);

      renderer.playMotionByGroup("Nod", 5, { priority: "force" });
      renderer.playMotionByGroup("Shake", 0);
      pump(600);

      expect(store.get(StandardParameter.AngleY)).toBeCloseTo(-8);
      expect(store.get(StandardParameter.AngleX)).toBeLessThan(1);
    });
  });

  it("moves the eyes by the engine under a model's Idle loop, and leaves it the head", async () => {
    served = IDLE_FIXTURE;
    renderer.lookAt({ x: 0.5, y: 0.25 });
    await renderer.loadModel("/x.iki");
    const store = playerRegistry.instances[0]!.store;

    pumpTo(0, 500);

    // The engine's spring settles the eyes in about 0.3 s.
    expect(store.get(StandardParameter.EyeballX)).toBeCloseTo(0.5, 2);
    expect(store.get(StandardParameter.EyeballY)).toBeCloseTo(0.25, 2);
    // AngleX is the Idle clip's (2° at 0.5 s); AngleY, which it does not
    // animate, rests.
    expect(store.get(StandardParameter.AngleX)).toBeCloseTo(2);
    expect(store.get(StandardParameter.AngleY)).toBe(0);
  });

  it("forwards a view to the player, and no view restores the box", () => {
    const player = playerRegistry.instances[0];
    const view = { x: 0, y: 0, width: 250, height: 100 };
    renderer.setView(view);
    expect(player.setView).toHaveBeenLastCalledWith(view);
    renderer.setView();
    expect(player.setView).toHaveBeenLastCalledWith(undefined);
  });

  it("hands a view set before initialize to the player it creates", async () => {
    const view = { x: 0, y: 10, width: 250, height: 100 };
    const early = createIkiRenderer({ canvas });
    early.setView(view);
    await early.initialize();
    expect(playerRegistry.instances[1].setView).toHaveBeenCalledWith(view);
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

  it("drops a load whose fetch lands after a later load finished", async () => {
    // The engine only supersedes loads that reach it in order; this one would
    // reach it last, and replace the model the host asked for after it.
    const slow = { ...FIXTURE, expressions: undefined };
    let resolveSlow!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/slow.iki"
          ? new Promise<Response>((resolve) => {
              resolveSlow = resolve;
            })
          : Promise.resolve({
              ok: true,
              text: async () => JSON.stringify(FIXTURE),
            } as Response),
      ),
    );
    const player = playerRegistry.instances[0]!;
    const loadSpy = vi.spyOn(player, "load");

    const slowLoad = renderer.loadModel("/slow.iki");
    await renderer.loadModel("/x.iki");
    resolveSlow({
      ok: true,
      text: async () => JSON.stringify(slow),
    } as Response);
    await slowLoad;

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(renderer.getAvailableExpressions()).toEqual(["smile", "surprised"]);
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

    pumpTo(0, 1000);
    // Confirms IkiMotion was rebuilt against the second load's store, not
    // left wired to the first load's (now-discarded) one, and that the gaze
    // was handed to the rebuilt one.
    expect(player.store.get(StandardParameter.EyeballX)).toBeCloseTo(0.5, 2);
  });
});
