import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMocks = vi.hoisted(() => {
  const frameBuffer = { id: "framebuffer" };
  const gl = {
    getParameter: vi.fn(() => frameBuffer),
    disable: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    drawingBufferWidth: 400,
    drawingBufferHeight: 200,
    FRAMEBUFFER_BINDING: 0x8ca6,
    DEPTH_TEST: 0x0b71,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
  };
  let nextInitializeResult = true;

  class MockGlManager {
    static instances: MockGlManager[] = [];

    initialize = vi.fn((_canvas: HTMLCanvasElement) => nextInitializeResult);
    release = vi.fn(() => undefined);
    getGl = vi.fn(() => gl);

    constructor() {
      MockGlManager.instances.push(this);
    }
  }

  class MockTextureManager {
    static instances: MockTextureManager[] = [];

    setGlManager = vi.fn((_manager: MockGlManager) => undefined);
    release = vi.fn(() => undefined);

    constructor() {
      MockTextureManager.instances.push(this);
    }
  }

  return {
    MockGlManager,
    MockTextureManager,
    frameBuffer,
    get nextInitializeResult() {
      return nextInitializeResult;
    },
    set nextInitializeResult(value: boolean) {
      nextInitializeResult = value;
    },
    gl,
  };
});

vi.mock("../src/cubism/lappglmanager", () => ({
  LAppGlManager: hostMocks.MockGlManager,
}));

vi.mock("../src/cubism/lapptexturemanager", () => ({
  LAppTextureManager: hostMocks.MockTextureManager,
}));

import { CubismModelHost } from "../src/cubism/model-host";

const originalDevicePixelRatio = window.devicePixelRatio;

beforeEach(() => {
  hostMocks.MockGlManager.instances = [];
  hostMocks.MockTextureManager.instances = [];
  hostMocks.nextInitializeResult = true;
  Object.values(hostMocks.gl).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) {
      value.mockClear();
    }
  });
  Object.defineProperty(window, "devicePixelRatio", {
    value: 2,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "devicePixelRatio", {
    value: originalDevicePixelRatio,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe("CubismModelHost", () => {
  it("throws when WebGL initialization fails", () => {
    hostMocks.nextInitializeResult = false;
    const host = new CubismModelHost(document.createElement("canvas"));

    expect(() => host.initialize()).toThrow(
      "Live2D: Failed to initialize WebGL context.",
    );
  });

  it("initializes WebGL state and exposes its managers", () => {
    const canvas = document.createElement("canvas");
    const host = new CubismModelHost(canvas);

    host.initialize();

    const glManager = hostMocks.MockGlManager.instances[0]!;
    const textureManager = hostMocks.MockTextureManager.instances[0]!;

    expect(glManager.initialize).toHaveBeenCalledWith(canvas);
    expect(textureManager.setGlManager).toHaveBeenCalledWith(glManager);
    expect(hostMocks.gl.getParameter).toHaveBeenCalledWith(
      hostMocks.gl.FRAMEBUFFER_BINDING,
    );
    expect(hostMocks.gl.disable).toHaveBeenCalledWith(hostMocks.gl.DEPTH_TEST);
    expect(hostMocks.gl.enable).toHaveBeenCalledWith(hostMocks.gl.BLEND);
    expect(hostMocks.gl.blendFunc).toHaveBeenCalledWith(
      hostMocks.gl.SRC_ALPHA,
      hostMocks.gl.ONE_MINUS_SRC_ALPHA,
    );
    expect(host.getCanvas()).toBe(canvas);
    expect(host.getGlManager()).toBe(glManager);
    expect(host.getTextureManager()).toBe(textureManager);
    expect(host.getFrameBuffer()).toBe(hostMocks.frameBuffer);
  });

  it("resizes using device pixel ratio and avoids redundant viewport calls", () => {
    const canvas = document.createElement("canvas");
    const host = new CubismModelHost(canvas);
    host.initialize();

    host.resizeToDisplaySize(100, 50);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(hostMocks.gl.viewport).toHaveBeenCalledWith(0, 0, 400, 200);

    hostMocks.gl.viewport.mockClear();
    host.resizeToDisplaySize(100, 50);

    expect(hostMocks.gl.viewport).not.toHaveBeenCalled();
  });

  it("disposes managers and clears framebuffer state", () => {
    const host = new CubismModelHost(document.createElement("canvas"));
    host.initialize();

    const glManager = hostMocks.MockGlManager.instances[0]!;
    const textureManager = hostMocks.MockTextureManager.instances[0]!;

    host.dispose();

    expect(textureManager.release).toHaveBeenCalled();
    expect(glManager.release).toHaveBeenCalled();
    expect(host.getFrameBuffer()).toBeNull();
  });
});
