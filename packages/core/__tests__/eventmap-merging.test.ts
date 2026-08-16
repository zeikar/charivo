import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/bus";

// What a third-party package (say @charivo/render-vrm) would write: extend
// EventMap via declaration merging, no core change required. This test exists
// to fail compilation if EventMap ever regresses to a closed type alias —
// `declare module` merging only works against an interface.
declare module "@charivo/core" {
  interface EventMap {
    "vrm:blendshape": { name: string; weight: number };
  }
}

describe("EventMap declaration merging", () => {
  it("lets an augmented event flow through the bus fully typed", () => {
    const bus = new EventBus();
    const listener = vi.fn((data: { name: string; weight: number }) => {
      void data;
    });

    bus.on("vrm:blendshape", listener);
    bus.emit("vrm:blendshape", { name: "smile", weight: 0.8 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ name: "smile", weight: 0.8 });

    bus.off("vrm:blendshape", listener);
    bus.emit("vrm:blendshape", { name: "smile", weight: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
