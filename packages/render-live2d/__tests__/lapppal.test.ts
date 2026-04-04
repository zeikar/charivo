import { afterEach, describe, expect, it, vi } from "vitest";
import { LAppPal } from "../src/cubism/lapppal";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  LAppPal.currentFrame = 0;
  LAppPal.lastFrame = 0;
  LAppPal.deltaTime = 0;
});

describe("LAppPal", () => {
  it("loads file bytes and reports their size", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    globalThis.fetch = vi.fn(
      async () =>
        ({
          arrayBuffer: async () => bytes,
        }) as Response,
    ) as typeof fetch;

    const callback = vi.fn();
    LAppPal.loadFileAsBytes("/model.bytes", callback);

    expect(globalThis.fetch).toHaveBeenCalledWith("/model.bytes");
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(bytes, 3);
    });
  });

  it("updates and reports delta time from Date.now()", () => {
    LAppPal.lastFrame = 1_000;
    vi.spyOn(Date, "now").mockReturnValue(1_500);

    LAppPal.updateTime();

    expect(LAppPal.currentFrame).toBe(1_500);
    expect(LAppPal.lastFrame).toBe(1_500);
    expect(LAppPal.getDeltaTime()).toBe(0.5);
  });

  it("keeps printMessage as a no-op", () => {
    expect(() => LAppPal.printMessage("hello")).not.toThrow();
  });
});
