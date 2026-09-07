import { describe, expect, it } from "vitest";
import { StandardParameter } from "@ikijs/format";
import { blendMotionWrite, HEAD_ANGLE_RANGE_DEG } from "../src/motion-blend";

const IDLE_IDS = [
  StandardParameter.MouthOpen,
  StandardParameter.EyeOpenLeft,
  StandardParameter.EyeOpenRight,
  StandardParameter.EyeballX,
  StandardParameter.EyeballY,
  StandardParameter.AngleX,
  StandardParameter.AngleY,
  StandardParameter.AngleZ,
  StandardParameter.Breath,
];

describe("blendMotionWrite", () => {
  it("passes every id through unchanged when there is no gaze", () => {
    for (const id of [
      ...IDLE_IDS,
      StandardParameter.HairSwayX,
      StandardParameter.MouthOpen,
    ]) {
      expect(blendMotionWrite(id, 0.37, undefined)).toBe(0.37);
    }
  });

  it("adds the head target on top of the idle sway, on the 26° range", () => {
    expect(HEAD_ANGLE_RANGE_DEG).toBe(26);
    const gaze = { x: 0.5, y: -0.25 };
    expect(blendMotionWrite(StandardParameter.AngleX, 2, gaze)).toBe(15);
    expect(blendMotionWrite(StandardParameter.AngleY, 2, gaze)).toBe(-4.5);
  });

  it("lets the host gaze win outright on the eyeballs", () => {
    const gaze = { x: 0.5, y: -0.25 };
    expect(blendMotionWrite(StandardParameter.EyeballX, 0.3, gaze)).toBe(0.5);
    expect(blendMotionWrite(StandardParameter.EyeballY, 0.3, gaze)).toBe(
      gaze.y,
    );
  });

  it("passes everything else through even with a gaze present", () => {
    const gaze = { x: 0.5, y: -0.25 };
    for (const id of [
      StandardParameter.AngleZ,
      StandardParameter.EyeOpenLeft,
      StandardParameter.EyeOpenRight,
      StandardParameter.Breath,
      StandardParameter.HairSwayX,
      StandardParameter.HairSwayZ,
      StandardParameter.MouthOpen,
    ]) {
      expect(blendMotionWrite(id, 0.37, gaze)).toBe(0.37);
    }
  });

  it("does not clamp — range clamping is the player's job", () => {
    expect(blendMotionWrite(StandardParameter.AngleX, 6, { x: 1, y: 0 })).toBe(
      32,
    );
  });
});
