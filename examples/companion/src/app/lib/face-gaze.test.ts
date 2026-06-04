import { describe, it, expect } from "vitest";
import {
  boundingBoxToGaze,
  createGazeSmoother,
  NEUTRAL_GAZE,
} from "./face-gaze";

const EPSILON = 1e-9;

describe("boundingBoxToGaze", () => {
  it("center box -> { x: 0, y: 0 }", () => {
    // A box centered exactly in the middle of the frame.
    const result = boundingBoxToGaze(
      { originX: 40, originY: 30, width: 20, height: 20 },
      100,
      80,
    );
    expect(result.x).toBeCloseTo(0, 9);
    expect(result.y).toBeCloseTo(0, 9);
  });

  it("box centered in left half (nx<0.5, user body-left in mirrored feed) -> positive x", () => {
    // When the user moves their face to their own left, the avatar's gaze goes to the avatar's right (positive x).
    const result = boundingBoxToGaze(
      { originX: 20, originY: 40, width: 10, height: 10 },
      100,
      100,
    );
    expect(result.x).toBeGreaterThan(0);
  });

  it("box centered in top half (ny<0.5) -> positive y", () => {
    const result = boundingBoxToGaze(
      { originX: 45, originY: 10, width: 10, height: 10 },
      100,
      100,
    );
    expect(result.y).toBeGreaterThan(0);
  });

  it("out-of-range box clamps to +/-1", () => {
    // Center well outside the frame (off the left + bottom). With the negated X
    // sign, a far-left center clamps to +1; the far-bottom center clamps to -1.
    const result = boundingBoxToGaze(
      { originX: -200, originY: 200, width: 20, height: 20 },
      100,
      100,
    );
    expect(result.x).toBe(1);
    expect(result.y).toBe(-1);
  });

  it("videoW=0 -> NEUTRAL_GAZE", () => {
    const result = boundingBoxToGaze(
      { originX: 10, originY: 10, width: 20, height: 20 },
      0,
      100,
    );
    expect(result).toEqual(NEUTRAL_GAZE);
  });

  it("videoH=0 -> NEUTRAL_GAZE", () => {
    const result = boundingBoxToGaze(
      { originX: 10, originY: 10, width: 20, height: 20 },
      100,
      0,
    );
    expect(result).toEqual(NEUTRAL_GAZE);
  });
});

describe("createGazeSmoother", () => {
  it("first call returns the first sample exactly (seed)", () => {
    const smooth = createGazeSmoother();
    const first = { x: 0.5, y: -0.3 };
    const result = smooth(first);
    expect(result.x).toBeCloseTo(first.x, 15);
    expect(result.y).toBeCloseTo(first.y, 15);
  });

  it("converges toward a held target over N steps", () => {
    const smooth = createGazeSmoother({ alpha: 0.35 });
    const seed = { x: 0, y: 0 };
    const target = { x: 1, y: 1 };

    smooth(seed);

    let prev = smooth(target);
    for (let i = 0; i < 50; i++) {
      const next = smooth(target);
      // Each step should be closer to target than the previous.
      const prevDist = Math.abs(target.x - prev.x);
      const nextDist = Math.abs(target.x - next.x);
      expect(nextDist).toBeLessThan(prevDist + EPSILON);
      prev = next;
    }

    // After many steps, should be very close to target.
    expect(prev.x).toBeCloseTo(1, 2);
    expect(prev.y).toBeCloseTo(1, 2);
  });

  it("second call moves toward target (not equal to seed)", () => {
    const smooth = createGazeSmoother({ alpha: 0.5 });
    smooth({ x: 0, y: 0 });
    const result = smooth({ x: 1, y: 0 });
    expect(result.x).toBeCloseTo(0.5, 9);
  });
});
