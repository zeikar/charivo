import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rendererMocks = vi.hoisted(() => {
  const loadCubismCore = vi.fn(async () => undefined);
  const playSafe = vi.fn();
  const cubismStartUp = vi.fn();
  const cubismInitialize = vi.fn();
  const updateTime = vi.fn();
  const printMessage = vi.fn();
  const gl = {
    clearColor: vi.fn(),
    clear: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_TEST: 0x0b71,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
  };
  const responsiveTeardowns: Array<ReturnType<typeof vi.fn>> = [];
  const setupResponsiveResize = vi.fn(
    (_canvas: HTMLCanvasElement, _resize: () => void) => {
      const teardown = vi.fn();
      responsiveTeardowns.push(teardown);
      return teardown;
    },
  );

  class MockHost {
    static instances: MockHost[] = [];

    initialize = vi.fn(() => undefined);
    resizeToDisplaySize = vi.fn((width: number, height: number) => {
      this.canvas.width = width;
      this.canvas.height = height;
    });
    dispose = vi.fn(() => undefined);
    getGlManager = vi.fn(() => ({
      getGl: () => gl,
    }));

    constructor(private readonly canvas: HTMLCanvasElement) {
      MockHost.instances.push(this);
    }
  }

  // Model units to view coordinates: halved, and lifted a quarter on y, so a
  // test can tell the matrix was applied and which axis is which.
  class MockModelMatrix {
    setWidth = vi.fn();
    transformX(value: number): number {
      return value * 0.5;
    }
    transformY(value: number): number {
      return value * 0.5 + 0.25;
    }
  }

  class MockModel {
    static instances: MockModel[] = [];

    ready = false;
    expressions = ["happy"];
    motionGroups: Record<string, number> = { Tap: 1, "Tap@Body": 1 };
    modelMatrix = new MockModelMatrix();

    loadAssets = vi.fn(async () => undefined);
    waitUntilReady = vi.fn(async () => {
      this.ready = true;
    });
    release = vi.fn(() => undefined);
    isReady = vi.fn(() => this.ready);
    setRealtimeLipSync = vi.fn((_enabled: boolean) => undefined);
    updateRealtimeLipSyncRms = vi.fn((_rms: number) => undefined);
    getAvailableExpressions = vi.fn(() => this.expressions);
    getAvailableMotionGroups = vi.fn(() => this.motionGroups);
    hasExpression = vi.fn((expressionId: string) =>
      this.expressions.includes(expressionId),
    );
    setExpression = vi.fn((_expressionId: string) => undefined);
    clearExpression = vi.fn(() => undefined);
    hasMotion = vi.fn(
      (group: string, index: number) =>
        typeof this.motionGroups[group] === "number" &&
        index < this.motionGroups[group]!,
    );
    startMotion = vi.fn(
      (
        _group: string,
        _index: number,
        _priority: number,
        _onFinished?: unknown,
        _onBegan?: unknown,
        _options?: { muteSound?: boolean },
      ) => undefined,
    );
    hitTest = vi.fn((_area: string, _x: number, _y: number) => false);
    setDragging = vi.fn((_x: number, _y: number) => undefined);
    update = vi.fn(() => undefined);
    draw = vi.fn((_projection: unknown) => undefined);
    getModel = vi.fn(() => ({
      getCanvasWidth: (): number => 2,
      getCanvasHeight: (): number => 4,
    }));
    getModelMatrix = vi.fn(() => this.modelMatrix);

    constructor() {
      MockModel.instances.push(this);
    }
  }

  class MockMatrix44 {
    scale = vi.fn((_x: number, _y: number) => undefined);
    multiplyByMatrix = vi.fn((_matrix: unknown) => undefined);
    loadIdentity = vi.fn(() => undefined);
    scaleRelative = vi.fn((_x: number, _y: number) => undefined);
    translateRelative = vi.fn((_x: number, _y: number) => undefined);
    transformX(value: number): number {
      return value;
    }
    transformY(value: number): number {
      return value;
    }
  }

  class MockViewMatrix {
    setScreenRect = vi.fn(
      (_left: number, _right: number, _bottom: number, _top: number) =>
        undefined,
    );
    scale = vi.fn((_x: number, _y: number) => undefined);
    setMaxScale = vi.fn((_scale: number) => undefined);
    setMinScale = vi.fn((_scale: number) => undefined);
    setMaxScreenRect = vi.fn(
      (_left: number, _right: number, _bottom: number, _top: number) =>
        undefined,
    );
    invertTransformX(value: number): number {
      return value;
    }
    invertTransformY(value: number): number {
      return value;
    }
  }

  class Option {
    logFunction?: (message: string) => void;
    loggingLevel?: number;
  }

  return {
    MockHost,
    MockModel,
    MockMatrix44,
    MockViewMatrix,
    Option,
    cubismInitialize,
    cubismStartUp,
    gl,
    loadCubismCore,
    playSafe,
    printMessage,
    responsiveTeardowns,
    setupResponsiveResize,
    updateTime,
  };
});

vi.mock("@framework/live2dcubismframework", () => ({
  CubismFramework: {
    startUp: rendererMocks.cubismStartUp,
    initialize: rendererMocks.cubismInitialize,
  },
  LogLevel: {
    LogLevel_Warning: 1,
  },
  Option: rendererMocks.Option,
}));

vi.mock("@framework/math/cubismmatrix44", () => ({
  CubismMatrix44: rendererMocks.MockMatrix44,
}));

vi.mock("@framework/math/cubismviewmatrix", () => ({
  CubismViewMatrix: rendererMocks.MockViewMatrix,
}));

vi.mock("../src/cubism/lappmodel", () => ({
  LAppModel: rendererMocks.MockModel,
}));

vi.mock("../src/cubism/model-host", () => ({
  CubismModelHost: rendererMocks.MockHost,
}));

vi.mock("../src/cubism/lapppal", () => ({
  LAppPal: {
    printMessage: rendererMocks.printMessage,
    updateTime: rendererMocks.updateTime,
  },
}));

vi.mock("../src/utils/cubism-core", () => ({
  loadCubismCore: rendererMocks.loadCubismCore,
}));

vi.mock("../src/utils/motion", () => ({
  playSafe: rendererMocks.playSafe,
}));

vi.mock("../src/utils/resize", () => ({
  setupResponsiveResize: rendererMocks.setupResponsiveResize,
}));

import { Live2DRendererImpl } from "../src/live2d-renderer";
import * as LAppDefine from "../src/cubism/lappdefine";

const originalDevicePixelRatio = window.devicePixelRatio;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

function createCanvasFixture(): HTMLCanvasElement {
  const parent = document.createElement("div");
  const canvas = document.createElement("canvas");
  parent.appendChild(canvas);
  document.body.appendChild(parent);

  Object.defineProperty(parent, "getBoundingClientRect", {
    value: () => ({
      width: 320,
      height: 240,
      left: 0,
      top: 0,
      right: 320,
      bottom: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    configurable: true,
  });

  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({
      width: 320,
      height: 240,
      left: 10,
      top: 20,
      right: 330,
      bottom: 260,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }),
    configurable: true,
  });

  return canvas;
}

beforeEach(() => {
  rendererMocks.MockHost.instances = [];
  rendererMocks.MockModel.instances = [];
  rendererMocks.responsiveTeardowns.length = 0;
  rendererMocks.loadCubismCore.mockClear();
  rendererMocks.playSafe.mockClear();
  rendererMocks.cubismStartUp.mockClear();
  rendererMocks.cubismInitialize.mockClear();
  rendererMocks.updateTime.mockClear();
  rendererMocks.printMessage.mockClear();
  rendererMocks.setupResponsiveResize.mockClear();
  Object.values(rendererMocks.gl).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) {
      value.mockClear();
    }
  });

  Object.defineProperty(window, "devicePixelRatio", {
    value: 1,
    configurable: true,
  });
  globalThis.requestAnimationFrame = vi.fn(() => 101);
  globalThis.cancelAnimationFrame = vi.fn();
  (
    Live2DRendererImpl as unknown as {
      cubismStarted: boolean;
    }
  ).cubismStarted = false;
});

afterEach(() => {
  Object.defineProperty(window, "devicePixelRatio", {
    value: originalDevicePixelRatio,
    configurable: true,
  });
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  (
    Live2DRendererImpl as unknown as {
      cubismStarted: boolean;
    }
  ).cubismStarted = false;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type MockModelInstance = InstanceType<typeof rendererMocks.MockModel>;

describe("Live2DRenderer", () => {
  it("throws when initialized without a canvas", async () => {
    const renderer = new Live2DRendererImpl();

    await expect(renderer.initialize()).rejects.toThrow(
      "Canvas element is required for Live2D rendering",
    );
  });

  it("loads Cubism, creates the host, and only starts Cubism once", async () => {
    const first = new Live2DRendererImpl({ canvas: createCanvasFixture() });
    const second = new Live2DRendererImpl({ canvas: createCanvasFixture() });

    await first.initialize();
    await second.initialize();

    expect(rendererMocks.loadCubismCore).toHaveBeenCalledTimes(2);
    expect(rendererMocks.cubismStartUp).toHaveBeenCalledTimes(1);
    expect(rendererMocks.cubismInitialize).toHaveBeenCalledTimes(1);
    expect(rendererMocks.updateTime).toHaveBeenCalledTimes(4);
    expect(rendererMocks.MockHost.instances).toHaveLength(2);
    expect(rendererMocks.MockHost.instances[0]?.initialize).toHaveBeenCalled();
    expect(rendererMocks.setupResponsiveResize).toHaveBeenCalledTimes(2);
    expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("loads models after initialization and releases the previous model", async () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });

    await expect(
      renderer.loadModel("/models/first.model3.json"),
    ).rejects.toThrow("Live2D renderer is not initialized");

    await renderer.initialize();
    await renderer.loadModel("/models/first.model3.json");
    await renderer.loadModel("/models/second.model3.json");

    const [firstModel, secondModel] = rendererMocks.MockModel.instances;
    expect(firstModel?.loadAssets).toHaveBeenCalledWith(
      "/models/first.model3.json",
      rendererMocks.MockHost.instances[0],
    );
    expect(firstModel?.waitUntilReady).toHaveBeenCalled();
    expect(firstModel?.release).toHaveBeenCalledTimes(1);
    expect(secondModel?.loadAssets).toHaveBeenCalledWith(
      "/models/second.model3.json",
      rendererMocks.MockHost.instances[0],
    );
  });

  /**
   * Hold the model the pending `loadModel()` call just created at
   * `waitUntilReady`, which that call reaches a microtask from now.
   */
  function holdLatestModel(): { model: MockModelInstance; land: () => void } {
    const model = rendererMocks.MockModel.instances.at(-1)!;
    let land!: () => void;
    model.waitUntilReady = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          land = () => {
            model.ready = true;
            resolve();
          };
        }),
    );
    return { model, land: () => land() };
  }

  it("keeps the latest load's model when an earlier load lands after it", async () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });
    await renderer.initialize();

    const slowLoad = renderer.loadModel("/models/slow.model3.json");
    const slow = holdLatestModel();
    slow.model.expressions = ["slow"];
    await renderer.loadModel("/models/fast.model3.json");
    const fast = rendererMocks.MockModel.instances.at(-1)!;

    slow.land();
    await slowLoad;

    expect(renderer.getAvailableExpressions()).toEqual(["happy"]);
    expect(slow.model.release).toHaveBeenCalledTimes(1);
    expect(fast.release).not.toHaveBeenCalled();
  });

  it("releases a model that lands after destroy instead of keeping it", async () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });
    await renderer.initialize();

    const load = renderer.loadModel("/models/slow.model3.json");
    const slow = holdLatestModel();
    await renderer.destroy();
    slow.land();
    await load;

    expect(renderer.getAvailableExpressions()).toEqual([]);
    expect(slow.model.release).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the host and reloads the last model after WebGL context restore", async () => {
    const canvas = createCanvasFixture();
    const renderer = new Live2DRendererImpl({ canvas });

    await renderer.initialize();
    await renderer.loadModel("/models/hiyori.model3.json");

    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(lostEvent, "preventDefault");

    canvas.dispatchEvent(lostEvent);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    await Promise.resolve();
    await Promise.resolve();

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    expect(rendererMocks.MockHost.instances).toHaveLength(2);
    expect(
      rendererMocks.MockModel.instances[1]?.loadAssets,
    ).toHaveBeenCalledWith(
      "/models/hiyori.model3.json",
      rendererMocks.MockHost.instances[1],
    );
  });

  it("exposes empty expression and motion data when no ready model exists", () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });

    expect(renderer.getAvailableExpressions()).toEqual([]);
    expect(renderer.getAvailableMotionGroups()).toEqual({});
  });

  it("guards lip-sync and expression controls on model readiness", async () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });
    await renderer.initialize();
    await renderer.loadModel("/models/hiyori.model3.json");

    const model = rendererMocks.MockModel.instances[0]!;
    model.ready = false;

    renderer.setRealtimeLipSync(true);
    renderer.updateRealtimeLipSyncRms(0.75);
    renderer.playExpression("happy");
    renderer.playMotionByGroup("Tap", 0);
    renderer.lookAt({ x: 0.5, y: -0.5 });

    expect(model.setRealtimeLipSync).not.toHaveBeenCalled();
    expect(model.updateRealtimeLipSyncRms).not.toHaveBeenCalled();
    expect(model.setExpression).not.toHaveBeenCalled();
    expect(model.startMotion).not.toHaveBeenCalled();
    expect(model.setDragging).not.toHaveBeenCalled();

    model.ready = true;
    renderer.setRealtimeLipSync(true);
    renderer.updateRealtimeLipSyncRms(0.75);
    renderer.playExpression("happy");
    renderer.playMotionByGroup("Tap", 0);
    renderer.lookAt({ x: 4, y: -4 });

    expect(model.setRealtimeLipSync).toHaveBeenCalledWith(true);
    expect(model.updateRealtimeLipSyncRms).toHaveBeenCalledWith(0.75);
    expect(model.setExpression).toHaveBeenCalledWith("happy");
    expect(model.startMotion).toHaveBeenCalledWith(
      "Tap",
      0,
      LAppDefine.PriorityNormal,
    );
    expect(model.setDragging).toHaveBeenCalledWith(1, -1);
  });

  it("carries muteSound through to the model, and omits it otherwise", async () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });
    await renderer.initialize();
    await renderer.loadModel("/models/hiyori.model3.json");

    const model = rendererMocks.MockModel.instances[0]!;
    model.ready = true;

    renderer.playMotionByGroup("Tap", 0, { muteSound: true });

    // The seam this guards: a flag dropped between the public renderer and the
    // model would leave every model-level mute test passing while a tool-call
    // motion still played its clip.
    expect(model.startMotion).toHaveBeenLastCalledWith(
      "Tap",
      0,
      LAppDefine.PriorityNormal,
      undefined,
      undefined,
      { muteSound: true },
    );

    renderer.playMotionByGroup("Tap", 0);

    expect(model.startMotion).toHaveBeenLastCalledWith(
      "Tap",
      0,
      LAppDefine.PriorityNormal,
    );
  });

  it("maps the motion priority onto Cubism's own priorities", async () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });
    await renderer.initialize();
    await renderer.loadModel("/models/hiyori.model3.json");

    const model = rendererMocks.MockModel.instances[0]!;
    model.ready = true;

    renderer.playMotionByGroup("Tap", 0, { priority: "force" });
    expect(model.startMotion.mock.calls.at(-1)).toEqual([
      "Tap",
      0,
      LAppDefine.PriorityForce,
    ]);

    renderer.playMotionByGroup("Tap", 0, { priority: "idle" });
    expect(model.startMotion.mock.calls.at(-1)).toEqual([
      "Tap",
      0,
      LAppDefine.PriorityIdle,
    ]);

    // "normal" and an omitted priority keep today's three-argument call.
    renderer.playMotionByGroup("Tap", 0, { priority: "normal" });
    expect(model.startMotion.mock.calls.at(-1)).toEqual([
      "Tap",
      0,
      LAppDefine.PriorityNormal,
    ]);

    renderer.playMotionByGroup("Tap", 0);
    expect(model.startMotion.mock.calls.at(-1)).toEqual([
      "Tap",
      0,
      LAppDefine.PriorityNormal,
    ]);

    renderer.playMotionByGroup("Tap", 0, {
      priority: "force",
      muteSound: true,
    });
    expect(model.startMotion.mock.calls.at(-1)).toEqual([
      "Tap",
      0,
      LAppDefine.PriorityForce,
      undefined,
      undefined,
      { muteSound: true },
    ]);
  });

  it("delegates expression release to the model once it is ready", async () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });

    expect(() => renderer.stopExpression()).not.toThrow();

    await renderer.initialize();
    await renderer.loadModel("/models/hiyori.model3.json");

    const model = rendererMocks.MockModel.instances[0]!;
    model.ready = false;

    renderer.stopExpression();
    expect(model.clearExpression).not.toHaveBeenCalled();

    model.ready = true;
    renderer.stopExpression();
    expect(model.clearExpression).toHaveBeenCalledTimes(1);
  });

  it("maps mouse input into drag and tap interactions", async () => {
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });

    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });
    await renderer.initialize();
    await renderer.loadModel("/models/hiyori.model3.json");

    const model = rendererMocks.MockModel.instances[0]!;
    model.hitTest.mockReturnValue(true);

    renderer.updateViewWithMouse({ clientX: 15, clientY: 26 });
    renderer.handleMouseTap({ clientX: 15, clientY: 26 });

    expect(model.setDragging).toHaveBeenCalledWith(10, 12);
    expect(model.hitTest).toHaveBeenCalledWith(
      LAppDefine.HitAreaNameBody,
      10,
      12,
    );
    expect(rendererMocks.playSafe).toHaveBeenCalledTimes(2);
    expect(rendererMocks.playSafe).toHaveBeenNthCalledWith(
      1,
      model,
      LAppDefine.MotionGroupBody,
      0,
      1,
    );
    expect(rendererMocks.playSafe).toHaveBeenNthCalledWith(
      2,
      model,
      LAppDefine.MotionGroupTap,
      0,
      1,
    );
  });

  describe("setGazeOrigin", () => {
    // The pointer below is view (10, 12), as in the test above. The mock
    // model's canvas is 2 x 4 units, so the point three quarters across and a
    // quarter down is (0.5, 1) from its centre, which the mock model matrix
    // puts at view (0.25, 0.75).
    async function readyRenderer() {
      Object.defineProperty(window, "devicePixelRatio", {
        value: 2,
        configurable: true,
      });
      const renderer = new Live2DRendererImpl({
        canvas: createCanvasFixture(),
      });
      await renderer.initialize();
      await renderer.loadModel("/models/hiyori.model3.json");
      return { renderer, model: rendererMocks.MockModel.instances.at(-1)! };
    }

    it("measures the drag from a point of the model, not the view's centre", async () => {
      const { renderer, model } = await readyRenderer();
      renderer.setGazeOrigin({ x: 0.75, y: 0.25 });

      renderer.updateViewWithMouse({ clientX: 15, clientY: 26 });

      expect(model.setDragging).toHaveBeenLastCalledWith(9.75, 11.25);
    });

    // The frame loop fits a model wider than one unit to a portrait canvas's
    // width, and there the pointer's view coordinates are width / height times
    // the drawn model's. The mock model is 2 units wide, so on a 200 x 400
    // canvas the origin's (0.25, 0.75) halves.
    it("scales the point where the model is fitted to a portrait canvas's width", async () => {
      const { renderer, model } = await readyRenderer();
      const canvas = document.querySelector("canvas")!;
      canvas.width = 200;
      canvas.height = 400;
      renderer.setGazeOrigin({ x: 0.75, y: 0.25 });

      renderer.updateViewWithMouse({ clientX: 15, clientY: 26 });

      expect(model.setDragging).toHaveBeenLastCalledWith(9.875, 11.625);
    });

    it("does not scale it for a model one unit wide, which a portrait canvas fits by height", async () => {
      const { renderer, model } = await readyRenderer();
      const canvas = document.querySelector("canvas")!;
      canvas.width = 200;
      canvas.height = 400;
      model.getModel = vi.fn(() => ({
        getCanvasWidth: () => 1,
        getCanvasHeight: () => 4,
      }));
      renderer.setGazeOrigin({ x: 0.75, y: 0.25 });

      renderer.updateViewWithMouse({ clientX: 15, clientY: 26 });

      // (0.25 x 1, 0.25 x 4) from the centre, through the mock matrix.
      expect(model.setDragging).toHaveBeenLastCalledWith(9.875, 11.25);
    });

    it("leaves taps where the pointer is", async () => {
      const { renderer, model } = await readyRenderer();
      renderer.setGazeOrigin({ x: 0.75, y: 0.25 });

      renderer.handleMouseTap({ clientX: 15, clientY: 26 });

      expect(model.hitTest).toHaveBeenCalledWith(
        LAppDefine.HitAreaNameBody,
        10,
        12,
      );
    });

    it("leaves lookAt alone: that is already a direction", async () => {
      const { renderer, model } = await readyRenderer();
      renderer.setGazeOrigin({ x: 0.75, y: 0.25 });

      renderer.lookAt({ x: 0.5, y: -0.5 });

      expect(model.setDragging).toHaveBeenLastCalledWith(0.5, -0.5);
    });

    it("holds across a model load, and goes back to the centre with no argument", async () => {
      const { renderer } = await readyRenderer();
      renderer.setGazeOrigin({ x: 0.75, y: 0.25 });
      await renderer.loadModel("/models/haru.model3.json");
      const next = rendererMocks.MockModel.instances.at(-1)!;

      renderer.updateViewWithMouse({ clientX: 15, clientY: 26 });
      expect(next.setDragging).toHaveBeenLastCalledWith(9.75, 11.25);

      renderer.setGazeOrigin();
      renderer.updateViewWithMouse({ clientX: 15, clientY: 26 });
      expect(next.setDragging).toHaveBeenLastCalledWith(10, 12);
    });

    it("refuses a non-finite point, and keeps the one it had", async () => {
      const { renderer, model } = await readyRenderer();
      renderer.setGazeOrigin({ x: 0.75, y: 0.25 });

      expect(() => renderer.setGazeOrigin({ x: Number.NaN, y: 0.25 })).toThrow(
        "finite x and y",
      );

      renderer.updateViewWithMouse({ clientX: 15, clientY: 26 });
      expect(model.setDragging).toHaveBeenLastCalledWith(9.75, 11.25);
    });
  });

  it("destroys the render loop, model, host, and resize teardown", async () => {
    const renderer = new Live2DRendererImpl({ canvas: createCanvasFixture() });
    await renderer.initialize();
    await renderer.loadModel("/models/hiyori.model3.json");

    const host = rendererMocks.MockHost.instances[0]!;
    const model = rendererMocks.MockModel.instances[0]!;
    const teardown = rendererMocks.responsiveTeardowns[0]!;

    await renderer.destroy();

    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(101);
    expect(model.release).toHaveBeenCalled();
    expect(host.dispose).toHaveBeenCalled();
    expect(teardown).toHaveBeenCalled();
  });
});
