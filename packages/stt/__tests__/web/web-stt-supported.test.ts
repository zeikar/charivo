import { describe, expect, it } from "vitest";
import { isWebSTTSupported } from "@charivo/stt/web";

describe("isWebSTTSupported (node environment)", () => {
  it("returns false without throwing when window is undefined", () => {
    expect(() => isWebSTTSupported()).not.toThrow();
    expect(isWebSTTSupported()).toBe(false);
  });
});
