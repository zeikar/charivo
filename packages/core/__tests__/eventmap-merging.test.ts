import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/bus";

// What a third-party package (say @charivo/render-vrm) would write: extend
// EventMap via declaration merging, no core change required. This test exists
// to fail compilation if EventMap ever regresses to a closed type alias —
// `declare module` merging only works against an interface.
declare module "@charivo/core" {
  interface EventMap {
    "vrm:blendshape": { name: string; weight: number };
    // Deliberately collide with Object.prototype members: an open EventMap
    // makes these names type-valid, so the bus's listener store must not be
    // prototype-backed (see the Object.create(null) comment in bus.ts).
    constructor: { collide: boolean };
    __proto__: { collide: boolean };
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

  it("handles augmented events named after Object.prototype members", () => {
    // Regression: a `{}`-backed store inherits `constructor`/`__proto__`, so
    // `??=` skipped the array init and on()/emit() threw for these names.
    const bus = new EventBus();
    const onConstructor = vi.fn();
    const onProto = vi.fn();

    bus.on("constructor", onConstructor);
    bus.on("__proto__", onProto);

    bus.emit("constructor", { collide: true });
    bus.emit("__proto__", { collide: true });

    expect(onConstructor).toHaveBeenCalledTimes(1);
    expect(onConstructor).toHaveBeenCalledWith({ collide: true });
    expect(onProto).toHaveBeenCalledTimes(1);

    bus.off("constructor", onConstructor);
    bus.emit("constructor", { collide: false });
    expect(onConstructor).toHaveBeenCalledTimes(1);

    // clear() must also rebuild a null-prototype store.
    bus.clear();
    bus.on("constructor", onConstructor);
    bus.emit("constructor", { collide: true });
    expect(onConstructor).toHaveBeenCalledTimes(2);
  });
});
