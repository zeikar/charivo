import { afterEach, describe, expect, it, vi } from "vitest";
import { setupResponsiveResize } from "../src/utils/resize";

const originalResizeObserver = window.ResizeObserver;

afterEach(() => {
  window.ResizeObserver = originalResizeObserver;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("setupResponsiveResize", () => {
  it("observes the canvas parent and runs initial resize", () => {
    vi.useFakeTimers();

    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();

    class FakeResizeObserver {
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }

    window.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;

    const canvas = document.createElement("canvas");
    const parent = document.createElement("div");
    parent.appendChild(canvas);
    document.body.appendChild(parent);

    const resize = vi.fn();
    const teardown = setupResponsiveResize(canvas, resize);

    vi.runAllTimers();

    expect(resize).toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith(parent);

    teardown();
    expect(unobserve).toHaveBeenCalledWith(parent);
    expect(disconnect).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
