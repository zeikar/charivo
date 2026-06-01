import { describe, expect, it } from "vitest";
import { PoseRestore, type RestorableModel } from "../src/cubism/pose-restore";

/** Minimal fake model backed by mutable `values`, with fixed defaults. */
function makeModel(
  current: number[],
  defaults: number[],
): RestorableModel & { values: number[] } {
  const values = [...current];
  return {
    values,
    getParameterCount: () => values.length,
    getParameterValueByIndex: (i) => values[i],
    getParameterDefaultValue: (i) => defaults[i],
    setParameterValueByIndex: (i, v) => {
      values[i] = v;
    },
  };
}

describe("PoseRestore", () => {
  it("eases from the captured pose to the defaults, reaching them exactly at the window", () => {
    const restore = new PoseRestore(0.5);
    const model = makeModel([10, -4], [0, 0]);

    // Halfway through the window → halfway from the captured pose to default.
    restore.step(model, 0.25);
    expect(model.values[0]).toBeCloseTo(5);
    expect(model.values[1]).toBeCloseTo(-2);

    // End of the window → exactly the defaults (no exponential tail).
    restore.step(model, 0.25);
    expect(model.values[0]).toBe(0);
    expect(model.values[1]).toBe(0);
  });

  it("is frame-rate independent: many small steps land like one large step", () => {
    const restore = new PoseRestore(1);
    const model = makeModel([100], [0]);

    for (let i = 0; i < 10; i++) restore.step(model, 0.1);

    // ~1.0s elapsed (0.1 × 10 accumulates a float epsilon), so it lands on the
    // default within tolerance — frame-rate independent.
    expect(model.values[0]).toBeCloseTo(0);
  });

  it("captures the start pose only once and never overshoots past the default", () => {
    const restore = new PoseRestore(0.5);
    const model = makeModel([8], [2]);

    restore.step(model, 10); // far past the window
    expect(model.values[0]).toBe(2);

    // A later step keeps using the captured start (8), not the current value (2),
    // and still holds the default — no drift, no overshoot.
    restore.step(model, 10);
    expect(model.values[0]).toBe(2);
  });

  it("re-captures from the current pose after reset", () => {
    const restore = new PoseRestore(0.5);
    const model = makeModel([10], [0]);

    restore.step(model, 0.5); // settles to 0
    expect(model.values[0]).toBe(0);

    // Simulate a new gesture leaving the parameter at 6, then a fresh restore.
    restore.reset();
    model.values[0] = 6;
    restore.step(model, 0.25); // halfway from 6 to 0
    expect(model.values[0]).toBeCloseTo(3);
  });

  it("snaps straight to the defaults when the duration is non-positive", () => {
    const restore = new PoseRestore(0);
    const model = makeModel([5, -5], [1, 1]);

    restore.step(model, 0.016);
    expect(model.values[0]).toBe(1);
    expect(model.values[1]).toBe(1);
  });
});
