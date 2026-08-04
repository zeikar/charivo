import { describe, expect, it, vi } from "vitest";
import { setupMouseTracking } from "../src";

describe("setupMouseTracking", () => {
  it("tracks pointer movement and taps on the canvas", () => {
    const canvas = document.createElement("canvas");
    const target = {
      updateViewWithMouse: vi.fn(),
      handleMouseTap: vi.fn(),
    };

    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({
        left: 10,
        right: 110,
        top: 20,
        bottom: 120,
      }),
      configurable: true,
    });

    const cleanup = setupMouseTracking({ canvas, target });

    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 30, clientY: 40 }),
    );
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 30, clientY: 40 }),
    );
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 300, clientY: 400 }),
    );

    expect(target.updateViewWithMouse).toHaveBeenCalledWith({
      clientX: 30,
      clientY: 40,
    });
    expect(target.handleMouseTap).toHaveBeenCalledTimes(1);

    cleanup();
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 50, clientY: 60 }),
    );
    expect(target.updateViewWithMouse).toHaveBeenCalledTimes(1);
  });

  it("can bind pointer tracking to document mode", () => {
    const canvas = document.createElement("canvas");
    const target = {
      updateViewWithMouse: vi.fn(),
      handleMouseTap: vi.fn(),
    };

    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        right: 100,
        top: 0,
        bottom: 100,
      }),
      configurable: true,
    });

    const cleanup = setupMouseTracking({
      canvas,
      mode: "document",
      target,
    });

    document.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 12, clientY: 34 }),
    );
    document.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 12, clientY: 34 }),
    );

    expect(target.updateViewWithMouse).toHaveBeenCalledWith({
      clientX: 12,
      clientY: 34,
    });
    expect(target.handleMouseTap).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
