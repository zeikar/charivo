import { describe, expect, it } from "vitest";
import { composeInstructions } from "./compose-instructions";

describe("composeInstructions", () => {
  it("joins blocks in order with newline", () => {
    expect(composeInstructions(["a", "b"])).toBe("a\nb");
  });

  it("drops null blocks", () => {
    expect(composeInstructions(["a", null, "b"])).toBe("a\nb");
  });

  it("drops undefined blocks", () => {
    expect(composeInstructions(["a", undefined, "b"])).toBe("a\nb");
  });

  it("drops empty-string blocks", () => {
    expect(composeInstructions(["a", "", "b"])).toBe("a\nb");
  });

  it("drops mixed null, undefined, and empty-string blocks", () => {
    expect(composeInstructions(["a", null, "b", undefined, ""])).toBe("a\nb");
  });
});
