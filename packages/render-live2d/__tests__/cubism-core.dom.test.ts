import { afterEach, describe, expect, it, vi } from "vitest";
import { isCubismCoreReady, loadCubismCore } from "../src/utils/cubism-core";

// Mock the core script import so tests don't load the real 207KB binary.
vi.mock("../CubismSdkForWeb-5-r.4/Core/live2dcubismcore.min.js", () => ({
  default: "/* mock cubism core */",
}));

const makeCoreReady = () => {
  (globalThis as Record<string, unknown>).Live2DCubismCore = {
    Version: { csmGetVersion: vi.fn().mockReturnValue(0x04020000) },
  };
};

const clearCore = () => {
  delete (globalThis as Record<string, unknown>).Live2DCubismCore;
};

afterEach(() => {
  clearCore();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.head.innerHTML = "";
});

describe("isCubismCoreReady", () => {
  it("returns false when Live2DCubismCore is not defined", () => {
    clearCore();
    expect(isCubismCoreReady()).toBe(false);
  });

  it("returns false when csmGetVersion throws", () => {
    (globalThis as Record<string, unknown>).Live2DCubismCore = {
      Version: {
        csmGetVersion: vi.fn().mockImplementation(() => {
          throw new Error("not ready");
        }),
      },
    };
    expect(isCubismCoreReady()).toBe(false);
  });

  it("returns true when csmGetVersion succeeds", () => {
    makeCoreReady();
    expect(isCubismCoreReady()).toBe(true);
  });
});

describe("loadCubismCore", () => {
  it("skips script injection when core is already ready", async () => {
    makeCoreReady();
    const spy = vi.spyOn(document.head, "appendChild");

    await loadCubismCore();

    expect(spy).not.toHaveBeenCalled();
  });

  it("injects a classic <script> element when core is not ready", async () => {
    vi.useFakeTimers();
    clearCore();

    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      // Simulate the injected script running and making the core available.
      makeCoreReady();
      return node;
    });

    const promise = loadCubismCore();
    vi.runAllTimers();
    await promise;

    expect(document.head.appendChild).toHaveBeenCalledOnce();
    const [node] = vi.mocked(document.head.appendChild).mock.calls[0];
    expect((node as HTMLElement).tagName).toBe("SCRIPT");
    expect((node as HTMLScriptElement).text).toBe("/* mock cubism core */");
  });

  it("polls until core becomes ready", async () => {
    vi.useFakeTimers();
    clearCore();

    let injectCount = 0;
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      injectCount++;
      // Core becomes ready only after polling starts (not synchronously).
      return node;
    });

    const promise = loadCubismCore();

    // First check: core not ready yet → schedules next setTimeout.
    // Now make core ready before the next tick.
    makeCoreReady();
    vi.runAllTimers();
    await promise;

    expect(injectCount).toBe(1);
  });
});
